import { describe, it, expect, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SweepService } from './sweep.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';

const D = (s: string) => new Prisma.Decimal(s);
const INTERNAL_ID = '9278c875-991c-4472-b2c4-6fd70c512719';

function fakeInternal(overrides: Record<string, unknown> = {}) {
  return {
    id: INTERNAL_ID,
    legal_name: 'Grupo Cashea Ve C.A.',
    rif: 'J-50154179-5',
    kind: 'internal',
    status: 'active',
    ...overrides,
  };
}

function fakeOrder(id: string, sum: string, dueDays: number, merchantId?: string) {
  const dueDate = new Date('2026-05-15');
  dueDate.setUTCDate(dueDate.getUTCDate() + dueDays);
  return {
    id,
    external_order_id: `ORD-${id}`,
    installments_sum: D(sum),
    merchant_id: merchantId ?? `merch-${id}`,
    num_installments: 3,
    max_due_date: dueDate,
    purchase_date: new Date('2026-04-01'),
  };
}

function makePrismaForSimulate() {
  return {
    investor: { findFirst: vi.fn() },
    setting: { findUnique: vi.fn() },
    order: { findMany: vi.fn().mockResolvedValue([]) },
    merchant: { findMany: vi.fn().mockResolvedValue([]) },
    installment: { findMany: vi.fn().mockResolvedValue([]) },
  } as unknown as PrismaService;
}

function makeAudit() {
  return { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
}

function setupHappyPathMocks(prisma: PrismaService) {
  (prisma.investor.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeInternal());
  (prisma.setting.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    id: 1,
    default_sweep_rate: D('0.08'),
  });
  (prisma.order.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
    fakeOrder('a', '60', 7),
    fakeOrder('b', '40', 14),
  ]);
  (prisma.merchant.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
    { id: 'merch-a', current_name: 'A C.A.', rif: 'J-1' },
    { id: 'merch-b', current_name: 'B C.A.', rif: 'J-2' },
  ]);
  (prisma.installment.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
    { order_id: 'a', amount: D('20'), due_date: new Date('2026-05-22') },
    { order_id: 'a', amount: D('20'), due_date: new Date('2026-05-29') },
    { order_id: 'a', amount: D('20'), due_date: new Date('2026-06-05') },
    { order_id: 'b', amount: D('20'), due_date: new Date('2026-05-29') },
    { order_id: 'b', amount: D('20'), due_date: new Date('2026-06-05') },
  ]);
}

describe('SweepService.simulateSweep', () => {
  it('happy path: derives capital, target=actual, shortfall=0, payload_hash format', async () => {
    const prisma = makePrismaForSimulate();
    setupHappyPathMocks(prisma);
    const svc = new SweepService(prisma, makeAudit());
    const r = (await svc.simulateSweep({
      term_days: 14,
      issue_date: new Date('2026-05-15'), // Friday
    })) as Record<string, Record<string, unknown>>;

    expect(r.rules_check).toEqual({
      maturity_boundary: true,
      order_indivisibility: true,
      round_down: true,
    });
    expect(r.pool!.order_count).toBe(2);
    expect(r.payouts!.nominal_actual).toBe('100.0000');
    // capital = 100 × price(0.08, 14d) = 100 × 0.996899 = 99.6899
    expect(r.payouts!.investor_capital).toBe('99.6899');
    expect(r.payouts!.investor_returned).toBe('0.0000');
    expect(r.payouts!.shortfall_pct).toBe('0.000000');
    expect(r.payload_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(r.warnings).toBeUndefined(); // 2026-05-15 is a Friday
  });

  it('throws 422 when no eligible orders fit', async () => {
    const prisma = makePrismaForSimulate();
    (prisma.investor.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeInternal());
    (prisma.setting.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 1,
      default_sweep_rate: D('0.08'),
    });
    (prisma.order.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const svc = new SweepService(prisma, makeAudit());
    await expect(
      svc.simulateSweep({ term_days: 14, issue_date: new Date('2026-05-15') }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('adds warnings: ["not_friday"] when issue_date is not a Friday', async () => {
    const prisma = makePrismaForSimulate();
    setupHappyPathMocks(prisma);
    const svc = new SweepService(prisma, makeAudit());
    const r = (await svc.simulateSweep({
      term_days: 14,
      issue_date: new Date('2026-05-14'), // Thursday
    })) as Record<string, unknown>;
    expect(r.warnings).toEqual(['not_friday']);
  });

  it('uses settings.default_sweep_rate when rate omitted', async () => {
    const prisma = makePrismaForSimulate();
    setupHappyPathMocks(prisma);
    const svc = new SweepService(prisma, makeAudit());
    const r = (await svc.simulateSweep({
      term_days: 14,
      issue_date: new Date('2026-05-15'),
    })) as Record<string, Record<string, unknown>>;
    expect(r.inputs!.rate).toBe('0.080000');
    expect(r.inputs!.rate_source).toBe('settings_default');
  });

  it('honors operator rate override', async () => {
    const prisma = makePrismaForSimulate();
    setupHappyPathMocks(prisma);
    const svc = new SweepService(prisma, makeAudit());
    const r = (await svc.simulateSweep({
      term_days: 14,
      issue_date: new Date('2026-05-15'),
      rate: 0.1,
    })) as Record<string, Record<string, unknown>>;
    expect(r.inputs!.rate).toBe('0.100000');
    expect(r.inputs!.rate_source).toBe('override');
  });

  it('payload_hash is deterministic across two simulate calls with same inputs', async () => {
    const prisma = makePrismaForSimulate();
    setupHappyPathMocks(prisma);
    const svc = new SweepService(prisma, makeAudit());
    const r1 = (await svc.simulateSweep({
      term_days: 14,
      issue_date: new Date('2026-05-15'),
    })) as Record<string, unknown>;
    setupHappyPathMocks(prisma);
    const r2 = (await svc.simulateSweep({
      term_days: 14,
      issue_date: new Date('2026-05-15'),
    })) as Record<string, unknown>;
    expect(r1.payload_hash).toBe(r2.payload_hash);
  });

  it('throws 400 when internal investor missing', async () => {
    const prisma = makePrismaForSimulate();
    (prisma.investor.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const svc = new SweepService(prisma, makeAudit());
    await expect(
      svc.simulateSweep({ term_days: 14, issue_date: new Date('2026-05-15') }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

function makePrismaForIssue(
  opts: {
    internal?: Record<string, unknown> | null;
    defaultSweepRate?: Prisma.Decimal;
    lockedOrders?: Array<{
      id: string;
      installments_sum: Prisma.Decimal;
      max_due_date: Date;
      merchant_id: string;
      status: string;
      external_order_id: string;
    }>;
    eligibleNow?: Array<{
      id: string;
      external_order_id: string;
      installments_sum: Prisma.Decimal;
      merchant_id: string;
      num_installments: number;
      max_due_date: Date;
      purchase_date: Date;
    }>;
    certificateCreateError?: Error;
  } = {},
) {
  const tx = {
    $queryRaw: vi.fn().mockImplementation(async (template: unknown) => {
      const sql = Array.isArray((template as { strings?: string[] }).strings)
        ? (template as { strings: string[] }).strings.join('?')
        : Array.isArray(template)
          ? (template as string[]).join('?')
          : String(template);
      if (sql.includes('FOR UPDATE')) return opts.lockedOrders ?? [];
      return [];
    }),
    investor: {
      findFirst: vi.fn().mockResolvedValue(opts.internal ?? fakeInternal()),
    },
    setting: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ id: 1, default_sweep_rate: opts.defaultSweepRate ?? D('0.08') }),
    },
    order: {
      findMany: vi.fn().mockResolvedValue(opts.eligibleNow ?? []),
      updateMany: vi.fn().mockResolvedValue({ count: opts.lockedOrders?.length ?? 0 }),
    },
    merchant: { findMany: vi.fn().mockResolvedValue([]) },
    installment: { findMany: vi.fn().mockResolvedValue([]) },
    certificate: {
      create: opts.certificateCreateError
        ? vi.fn().mockRejectedValue(opts.certificateCreateError)
        : vi.fn().mockImplementation(async ({ data }: { data: unknown }) => ({
            id: 'cert-sweep-1',
            ...(data as object),
          })),
    },
    certificateOrder: {
      createMany: vi.fn().mockResolvedValue({ count: opts.lockedOrders?.length ?? 0 }),
    },
    certificateEvent: { create: vi.fn().mockResolvedValue({ id: 'evt-1' }) },
  };
  const prisma = {
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    ...tx,
  } as unknown as PrismaService;
  (prisma as unknown as { _tx: typeof tx })._tx = tx;
  return prisma;
}

describe('SweepService.issueSweep', () => {
  it('happy path: locks orders, inserts sweep cert, updates orders, audits', async () => {
    const lockedOrders = [
      {
        id: 'o-a',
        installments_sum: D('60'),
        max_due_date: new Date('2026-05-22'),
        merchant_id: 'm-a',
        status: 'available',
        external_order_id: 'ORD-a',
      },
      {
        id: 'o-b',
        installments_sum: D('40'),
        max_due_date: new Date('2026-05-29'),
        merchant_id: 'm-b',
        status: 'available',
        external_order_id: 'ORD-b',
      },
    ];
    const eligibleNow = lockedOrders.map((o) => ({
      ...o,
      num_installments: 3,
      purchase_date: new Date('2026-04-01'),
    }));
    const prisma = makePrismaForIssue({ lockedOrders, eligibleNow });
    const audit = makeAudit();
    const svc = new SweepService(prisma, audit);

    // Pre-run simulate to obtain the deterministic payload_hash.
    (prisma.investor.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeInternal());
    (prisma.setting.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 1,
      default_sweep_rate: D('0.08'),
    });
    (prisma.order.findMany as ReturnType<typeof vi.fn>).mockReset();
    (prisma.order.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce(eligibleNow);
    (prisma.merchant.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'm-a', current_name: 'A', rif: 'J-1' },
      { id: 'm-b', current_name: 'B', rif: 'J-2' },
    ]);
    (prisma.installment.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const sim = (await svc.simulateSweep({
      term_days: 14,
      issue_date: new Date('2026-05-15'),
    })) as Record<string, Record<string, unknown>>;

    // Re-prime the order.findMany mock for the issue path's eligibleNow re-fetch
    (prisma.order.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce(eligibleNow);

    const result = await svc.issueSweep(
      {
        term_days: 14,
        issue_date: new Date('2026-05-15'),
        order_ids: sim.pool!.order_ids as string[],
        expected_payload_hash: sim.payload_hash as unknown as string,
      },
      'actor-1',
    );

    const tx = (
      prisma as unknown as {
        _tx: {
          certificate: { create: ReturnType<typeof vi.fn> };
          certificateOrder: { createMany: ReturnType<typeof vi.fn> };
          order: { updateMany: ReturnType<typeof vi.fn> };
          certificateEvent: { create: ReturnType<typeof vi.fn> };
        };
      }
    )._tx;
    expect(tx.certificate.create).toHaveBeenCalledOnce();
    const createArg = tx.certificate.create.mock.calls[0]![0] as {
      data: { certificate_type: string; investor_id: string };
    };
    expect(createArg.data.certificate_type).toBe('sweep');
    expect(createArg.data.investor_id).toBe(INTERNAL_ID);
    expect(tx.certificateOrder.createMany).toHaveBeenCalledOnce();
    expect(tx.order.updateMany).toHaveBeenCalledOnce();
    expect(tx.certificateEvent.create).toHaveBeenCalledOnce();
    expect(audit.recordChange).toHaveBeenCalledOnce();
    expect((result as { id: string; status: string }).id).toBe('cert-sweep-1');
    expect((result as { id: string; status: string }).status).toBe('draft');
  });

  it('throws 422 when locked set differs from current eligible set', async () => {
    const lockedOrders = [
      {
        id: 'o-a',
        installments_sum: D('60'),
        max_due_date: new Date('2026-05-22'),
        merchant_id: 'm-a',
        status: 'available',
        external_order_id: 'ORD-a',
      },
    ];
    const eligibleNow = [
      ...lockedOrders.map((o) => ({
        ...o,
        num_installments: 3,
        purchase_date: new Date('2026-04-01'),
      })),
      {
        id: 'o-new',
        external_order_id: 'ORD-new',
        installments_sum: D('25'),
        merchant_id: 'm-c',
        num_installments: 2,
        max_due_date: new Date('2026-05-22'),
        purchase_date: new Date('2026-05-10'),
      },
    ];
    const prisma = makePrismaForIssue({ lockedOrders, eligibleNow });
    const svc = new SweepService(prisma, makeAudit());
    await expect(
      svc.issueSweep(
        {
          term_days: 14,
          issue_date: new Date('2026-05-15'),
          order_ids: ['o-a'],
          expected_payload_hash: 'a'.repeat(64),
        },
        'actor-1',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('throws 409 with cycle_week when Prisma P2002 fires (sweep already this week)', async () => {
    const lockedOrders = [
      {
        id: 'o-a',
        installments_sum: D('60'),
        max_due_date: new Date('2026-05-22'),
        merchant_id: 'm-a',
        status: 'available',
        external_order_id: 'ORD-a',
      },
    ];
    const eligibleNow = lockedOrders.map((o) => ({
      ...o,
      num_installments: 3,
      purchase_date: new Date('2026-04-01'),
    }));
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on uq_certs_one_sweep_per_cycle',
      { code: 'P2002', clientVersion: 'test', meta: { target: ['cycle_week'] } },
    );
    const prisma = makePrismaForIssue({
      lockedOrders,
      eligibleNow,
      certificateCreateError: p2002,
    });
    const svc = new SweepService(prisma, makeAudit());

    // Pre-run simulate so we have a real payload_hash for this scenario
    (prisma.investor.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeInternal());
    (prisma.setting.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 1,
      default_sweep_rate: D('0.08'),
    });
    (prisma.order.findMany as ReturnType<typeof vi.fn>).mockReset();
    (prisma.order.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce(eligibleNow);
    (prisma.merchant.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'm-a', current_name: 'A', rif: 'J-1' },
    ]);
    (prisma.installment.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const sim = (await svc.simulateSweep({
      term_days: 14,
      issue_date: new Date('2026-05-15'),
    })) as Record<string, Record<string, unknown>>;

    // Re-prime the order.findMany mock for the issue path's eligibleNow re-fetch
    (prisma.order.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce(eligibleNow);

    await expect(
      svc.issueSweep(
        {
          term_days: 14,
          issue_date: new Date('2026-05-15'),
          order_ids: sim.pool!.order_ids as string[],
          expected_payload_hash: sim.payload_hash as unknown as string,
        },
        'actor-1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
