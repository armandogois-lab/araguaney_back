import { describe, it, expect, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CertificatesService } from './certificates.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';

const D = (s: string) => new Prisma.Decimal(s);

function fakeInvestor(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    legal_name: 'Inversora Alpha',
    rif: 'J-12345678-9',
    kind: 'juridica',
    status: 'active',
    ...overrides,
  };
}

function fakeOrder(id: string, sum: string, dueDays: number) {
  const dueDate = new Date('2026-05-15');
  dueDate.setUTCDate(dueDate.getUTCDate() + dueDays);
  return {
    id,
    external_order_id: `ORD-${id}`,
    installments_sum: D(sum),
    merchant_id: `merch-${id}`,
    num_installments: 3,
    max_due_date: dueDate,
    purchase_date: new Date('2026-04-01'),
  };
}

function makePrismaForSimulate() {
  return {
    investor: { findUnique: vi.fn() },
    order: { findMany: vi.fn().mockResolvedValue([]) },
    merchant: { findMany: vi.fn().mockResolvedValue([]) },
    installment: { findMany: vi.fn().mockResolvedValue([]) },
  } as unknown as PrismaService;
}

function makeAudit() {
  return { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
}

describe('CertificatesService.simulate', () => {
  it('happy path: returns full simulation with rules_check all true', async () => {
    const prisma = makePrismaForSimulate();
    (prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeInvestor());
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

    const svc = new CertificatesService(prisma, makeAudit());
    const r = await svc.simulate({
      investor_id: 'inv-1',
      capital: 100,
      rate: 0.13,
      term_days: 42,
      issue_date: new Date('2026-05-15'),
    });

    expect(r.rules_check).toEqual({
      maturity_boundary: true,
      order_indivisibility: true,
      round_down: true,
    });
    expect(r.pool.order_count).toBe(2);
    expect(r.payouts.nominal_actual).toBe('100.0000');
    expect(r.payload_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('throws 404 when investor not found', async () => {
    const prisma = makePrismaForSimulate();
    (prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const svc = new CertificatesService(prisma, makeAudit());
    await expect(
      svc.simulate({
        investor_id: 'missing',
        capital: 100,
        rate: 0.13,
        term_days: 42,
        issue_date: new Date('2026-05-15'),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does NOT block investor.kind=internal (Cashea Valores can issue standard certs too)', async () => {
    const prisma = makePrismaForSimulate();
    (prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      fakeInvestor({ kind: 'internal' }),
    );
    const svc = new CertificatesService(prisma, makeAudit());
    // The previous behavior was: throw BadRequestException("Inversor interno
    // reservado para certificados sweep"). That restriction was removed so
    // Cashea Valores (the internal investor used for sweep) can also be the
    // counterparty of standard certs. Asserting it does NOT throw a 400 for
    // the kind reason — failures from the stub (e.g. 422 no eligible orders)
    // are downstream and unrelated.
    const err = await svc
      .simulate({
        investor_id: 'inv-1',
        capital: 100,
        rate: 0.13,
        term_days: 42,
        issue_date: new Date('2026-05-15'),
      })
      .catch((e) => e);
    if (err) {
      expect(err).not.toBeInstanceOf(BadRequestException);
    }
  });

  it('throws 400 when investor.status=inactive', async () => {
    const prisma = makePrismaForSimulate();
    (prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      fakeInvestor({ status: 'inactive' }),
    );
    const svc = new CertificatesService(prisma, makeAudit());
    await expect(
      svc.simulate({
        investor_id: 'inv-1',
        capital: 100,
        rate: 0.13,
        term_days: 42,
        issue_date: new Date('2026-05-15'),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws 422 when no eligible orders fit', async () => {
    const prisma = makePrismaForSimulate();
    (prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeInvestor());
    (prisma.order.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const svc = new CertificatesService(prisma, makeAudit());
    await expect(
      svc.simulate({
        investor_id: 'inv-1',
        capital: 100,
        rate: 0.13,
        term_days: 42,
        issue_date: new Date('2026-05-15'),
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('payload_hash is deterministic across two simulate calls with same inputs', async () => {
    const prisma = makePrismaForSimulate();
    const setup = () => {
      (prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        fakeInvestor(),
      );
      (prisma.order.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        fakeOrder('a', '60', 7),
      ]);
      (prisma.merchant.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { id: 'merch-a', current_name: 'A', rif: 'J-1' },
      ]);
      (prisma.installment.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { order_id: 'a', amount: D('60'), due_date: new Date('2026-05-22') },
      ]);
    };
    const svc = new CertificatesService(prisma, makeAudit());
    setup();
    const r1 = await svc.simulate({
      investor_id: 'inv-1',
      capital: 100,
      rate: 0.13,
      term_days: 42,
      issue_date: new Date('2026-05-15'),
    });
    setup();
    const r2 = await svc.simulate({
      investor_id: 'inv-1',
      capital: 100,
      rate: 0.13,
      term_days: 42,
      issue_date: new Date('2026-05-15'),
    });
    expect(r1.payload_hash).toBe(r2.payload_hash);
  });

  it('aggregates concentration_top and total_distinct_merchants', async () => {
    const prisma = makePrismaForSimulate();
    (prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeInvestor());
    (prisma.order.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { ...fakeOrder('a', '70', 7), merchant_id: 'big' },
      { ...fakeOrder('b', '30', 14), merchant_id: 'small' },
    ]);
    (prisma.merchant.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'big', current_name: 'Big Merchant', rif: 'J-BIG' },
      { id: 'small', current_name: 'Small Merchant', rif: 'J-SML' },
    ]);
    (prisma.installment.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const svc = new CertificatesService(prisma, makeAudit());
    const r = await svc.simulate({
      investor_id: 'inv-1',
      capital: 100,
      rate: 0.13,
      term_days: 42,
      issue_date: new Date('2026-05-15'),
    });
    expect(r.concentration.total_distinct_merchants).toBe(2);
    expect(r.concentration.top[0]!.merchant_id).toBe('big');
    expect(r.concentration.top[0]!.amount).toBe('70.0000');
  });

  it('filters out orders with installments due before cert issue_date', async () => {
    const prisma = makePrismaForSimulate();
    (prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeInvestor());
    (prisma.order.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const svc = new CertificatesService(prisma, makeAudit());
    await svc.simulate({
      investor_id: 'inv-1',
      capital: 100,
      rate: 0.13,
      term_days: 42,
      issue_date: new Date('2026-05-15'),
    }).catch(() => undefined);

    const call = (prisma.order.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.where).toMatchObject({
      status: 'available',
      min_due_date: { gte: new Date('2026-05-15') },
      max_due_date: { lte: new Date('2026-06-26') }, // 2026-05-15 + 42d
    });
    expect(call.select).toMatchObject({ min_due_date: true, max_due_date: true });
  });
});

function makePrismaForIssue(
  opts: {
    investor?: Record<string, unknown> | null;
    lockedOrders?: Array<{
      id: string;
      installments_sum: Prisma.Decimal;
      max_due_date: Date;
      merchant_id: string;
      status: string;
      external_order_id?: string;
    }>;
    certificateCode?: string;
  } = {},
) {
  const tx = {
    $queryRaw: vi.fn().mockImplementation(async (arg: unknown) => {
      // Prisma.sql`...` returns a Sql object with a `.strings` array; tagged-template
      // form receives a TemplateStringsArray directly. Handle both.
      let sql = '';
      if (Array.isArray(arg)) {
        sql = (arg as unknown as string[]).join('?');
      } else if (arg && typeof arg === 'object' && 'strings' in (arg as Record<string, unknown>)) {
        const strings = (arg as { strings: string[] }).strings;
        sql = Array.isArray(strings) ? strings.join('?') : String(arg);
      } else {
        sql = String(arg);
      }
      if (sql.includes('FOR UPDATE')) {
        return (opts.lockedOrders ?? []).map((o) => ({
          id: o.id,
          external_order_id: o.external_order_id ?? `ORD-${o.id}`,
          installments_sum: o.installments_sum,
          max_due_date: o.max_due_date,
          merchant_id: o.merchant_id,
          status: o.status,
        }));
      }
      if (sql.includes('next_certificate_code')) {
        return [{ code: opts.certificateCode ?? 'C9999A' }];
      }
      return [];
    }),
    investor: { findUnique: vi.fn().mockResolvedValue(opts.investor ?? fakeInvestor()) },
    order: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: opts.lockedOrders?.length ?? 0 }),
    },
    merchant: { findMany: vi.fn().mockResolvedValue([]) },
    installment: { findMany: vi.fn().mockResolvedValue([]) },
    certificate: {
      create: vi.fn().mockImplementation(async ({ data }: { data: unknown }) => ({
        id: 'cert-1',
        ...(data as object),
      })),
    },
    certificateOrder: {
      createMany: vi.fn().mockResolvedValue({ count: opts.lockedOrders?.length ?? 0 }),
    },
    certificateEvent: { create: vi.fn().mockResolvedValue({ id: 'evt-1' }) },
    auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
  };
  const prisma = {
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    ...tx,
  } as unknown as PrismaService;
  (prisma as unknown as { _tx: typeof tx })._tx = tx;
  return prisma;
}

describe('CertificatesService.issue', () => {
  it('happy path: locks orders, inserts cert+orders+events, updates orders, records audit', async () => {
    const lockedOrders = [
      {
        id: 'o-a',
        installments_sum: D('60'),
        max_due_date: new Date('2026-05-22'),
        merchant_id: 'm-a',
        status: 'available',
      },
      {
        id: 'o-b',
        installments_sum: D('40'),
        max_due_date: new Date('2026-05-29'),
        merchant_id: 'm-b',
        status: 'available',
      },
    ];
    const prisma = makePrismaForIssue({ lockedOrders });

    const audit = makeAudit();
    const svc = new CertificatesService(prisma, audit);
    // Pre-run simulate to get expected_payload_hash
    (prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeInvestor());
    (prisma.order.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      lockedOrders.map((o) => ({
        ...o,
        external_order_id: `ORD-${o.id}`,
        num_installments: 3,
        purchase_date: new Date('2026-04-01'),
      })),
    );
    (prisma.merchant.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'm-a', current_name: 'A', rif: 'J-1' },
      { id: 'm-b', current_name: 'B', rif: 'J-2' },
    ]);
    (prisma.installment.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const sim = await svc.simulate({
      investor_id: 'inv-1',
      capital: 100,
      rate: 0.13,
      term_days: 42,
      issue_date: new Date('2026-05-15'),
    });
    const expectedHash = sim.payload_hash;
    const orderIds = sim.pool.order_ids;

    const result = await svc.issue(
      {
        investor_id: 'inv-1',
        capital: 100,
        rate: 0.13,
        term_days: 42,
        issue_date: new Date('2026-05-15'),
        order_ids: orderIds,
        expected_payload_hash: expectedHash,
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
    expect(tx.certificateOrder.createMany).toHaveBeenCalledOnce();
    expect(tx.order.updateMany).toHaveBeenCalledOnce();
    expect(tx.certificateEvent.create).toHaveBeenCalledOnce();
    expect(audit.recordChange).toHaveBeenCalledOnce();
    expect((result as { id: string }).id).toBe('cert-1');
  });

  it('throws 409 when one of the locked orders has status != available', async () => {
    const lockedOrders = [
      {
        id: 'o-a',
        installments_sum: D('60'),
        max_due_date: new Date('2026-05-22'),
        merchant_id: 'm-a',
        status: 'assigned',
      },
    ];
    const prisma = makePrismaForIssue({ lockedOrders });
    const svc = new CertificatesService(prisma, makeAudit());
    await expect(
      svc.issue(
        {
          investor_id: 'inv-1',
          capital: 100,
          rate: 0.13,
          term_days: 42,
          issue_date: new Date('2026-05-15'),
          order_ids: ['o-a'],
          expected_payload_hash: 'a'.repeat(64),
        },
        'actor-1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws 409 when one of the order_ids does not exist', async () => {
    const prisma = makePrismaForIssue({ lockedOrders: [] });
    const svc = new CertificatesService(prisma, makeAudit());
    await expect(
      svc.issue(
        {
          investor_id: 'inv-1',
          capital: 100,
          rate: 0.13,
          term_days: 42,
          issue_date: new Date('2026-05-15'),
          order_ids: ['ghost'],
          expected_payload_hash: 'a'.repeat(64),
        },
        'actor-1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws 422 when expected_payload_hash does not match recomputed', async () => {
    const lockedOrders = [
      {
        id: 'o-a',
        installments_sum: D('60'),
        max_due_date: new Date('2026-05-22'),
        merchant_id: 'm-a',
        status: 'available',
      },
    ];
    const prisma = makePrismaForIssue({ lockedOrders });
    const svc = new CertificatesService(prisma, makeAudit());
    await expect(
      svc.issue(
        {
          investor_id: 'inv-1',
          capital: 100,
          rate: 0.13,
          term_days: 42,
          issue_date: new Date('2026-05-15'),
          order_ids: ['o-a'],
          expected_payload_hash: 'b'.repeat(64),
        },
        'actor-1',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('throws 422 when client order_ids do not match recomputed pool', async () => {
    const lockedOrders = [
      {
        id: 'o-a',
        installments_sum: D('500'),
        max_due_date: new Date('2026-05-22'),
        merchant_id: 'm-a',
        status: 'available',
      },
    ];
    const prisma = makePrismaForIssue({ lockedOrders });
    const svc = new CertificatesService(prisma, makeAudit());
    await expect(
      svc.issue(
        {
          investor_id: 'inv-1',
          capital: 100,
          rate: 0.13,
          term_days: 42,
          issue_date: new Date('2026-05-15'),
          order_ids: ['o-a'], // 500 > target ~101.54 → recomputed pool would be empty, mismatch
          expected_payload_hash: 'a'.repeat(64),
        },
        'actor-1',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('throws 422 when MAX(max_due_date) > maturity_date', async () => {
    const lockedOrders = [
      {
        id: 'o-a',
        installments_sum: D('60'),
        max_due_date: new Date('2027-12-31'),
        merchant_id: 'm-a',
        status: 'available',
      },
    ];
    const prisma = makePrismaForIssue({ lockedOrders });
    const svc = new CertificatesService(prisma, makeAudit());
    await expect(
      svc.issue(
        {
          investor_id: 'inv-1',
          capital: 100,
          rate: 0.13,
          term_days: 42,
          issue_date: new Date('2026-05-15'),
          order_ids: ['o-a'],
          expected_payload_hash: 'a'.repeat(64),
        },
        'actor-1',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('inserts certificate_event with event_type=draft_created and updates orders to reserved', async () => {
    const lockedOrders = [
      {
        id: 'o-a',
        installments_sum: D('60'),
        max_due_date: new Date('2026-05-22'),
        merchant_id: 'm-a',
        status: 'available',
      },
    ];
    const prisma = makePrismaForIssue({ lockedOrders });
    const audit = makeAudit();
    const svc = new CertificatesService(prisma, audit);
    // Pre-simulate to get hash
    (prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeInvestor());
    (prisma.order.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      lockedOrders.map((o) => ({
        ...o,
        external_order_id: `ORD-${o.id}`,
        num_installments: 3,
        purchase_date: new Date('2026-04-01'),
      })),
    );
    (prisma.merchant.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'm-a', current_name: 'A', rif: 'J-1' },
    ]);
    (prisma.installment.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const sim = await svc.simulate({
      investor_id: 'inv-1',
      capital: 100,
      rate: 0.13,
      term_days: 42,
      issue_date: new Date('2026-05-15'),
    });

    await svc.issue(
      {
        investor_id: 'inv-1',
        capital: 100,
        rate: 0.13,
        term_days: 42,
        issue_date: new Date('2026-05-15'),
        order_ids: sim.pool.order_ids,
        expected_payload_hash: sim.payload_hash,
      },
      'actor-1',
    );

    const tx = (
      prisma as unknown as {
        _tx: {
          certificateEvent: { create: ReturnType<typeof vi.fn> };
          order: { updateMany: ReturnType<typeof vi.fn> };
        };
      }
    )._tx;
    const evtCall = tx.certificateEvent.create.mock.calls[0]![0] as {
      data: { event_type: string; payload: unknown };
    };
    expect(evtCall.data.event_type).toBe('draft_created');
    const updCall = tx.order.updateMany.mock.calls[0]![0] as {
      where: { id: { in: string[] } };
      data: { status: string };
    };
    expect(updCall.data.status).toBe('reserved');
    expect(updCall.where.id.in).toEqual(['o-a']);
  });
});

function makePrismaForListDetail() {
  return {
    certificate: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn(),
    },
    rolePermission: {
      findFirst: vi.fn().mockResolvedValue({ id: 'rp-1' }),
    },
  } as unknown as PrismaService;
}

function fakeCertRow(): Record<string, unknown> {
  return {
    id: 'cert-1',
    certificate_code: 'C4572A',
    certificate_type: 'standard',
    status: 'issued',
    investor: { id: 'inv-1', legal_name: 'Inversora Alpha', rif: 'J-12345678-9' },
    investor_capital: D('100000'),
    annual_rate: D('0.13'),
    term_days: 42,
    price: D('0.985060'),
    nominal_target: D('101516.6589'),
    nominal_actual: D('101516'),
    investor_paid: D('99999.3510'),
    investor_returned: D('0.6490'),
    investor_yield: D('1516.6490'),
    shortfall_pct: D('0.000006'),
    issue_date: new Date('2026-04-27'),
    maturity_date: new Date('2026-06-08'),
    cycle_week: '2026-W18',
    issued_by: { id: 'user-1', email: 'op@cashea.app', full_name: 'Op' },
    created_at: new Date('2026-04-27T10:00:00Z'),
    payload_hash: 'a'.repeat(64),
    deleted_at: null,
  };
}

describe('CertificatesService.list', () => {
  it('returns paginated mapped certificates filtering deleted_at IS NULL', async () => {
    const prisma = makePrismaForListDetail();
    (prisma.certificate.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      fakeCertRow(),
    ]);
    (prisma.certificate.count as ReturnType<typeof vi.fn>).mockResolvedValueOnce(1);
    const svc = new CertificatesService(prisma, makeAudit());
    const r = await svc.list(
      { limit: 50, offset: 0, sort: 'issue_date_desc', include_deleted: false },
      'admin',
    );
    expect(r.total).toBe(1);
    expect(r.data[0]!.certificate_code).toBe('C4572A');
    expect(r.data[0]!.investor_capital).toBe('100000.0000');
    const call = (prisma.certificate.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.where.deleted_at).toBeNull();
  });
});

describe('CertificatesService.detail', () => {
  it('returns mapped detail with orders and events', async () => {
    const prisma = makePrismaForListDetail();
    (prisma.certificate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...fakeCertRow(),
      certificate_orders: [
        {
          installments_sum_snapshot: D('300'),
          assigned_at: new Date('2026-04-27T10:00:00Z'),
          order: {
            id: 'o-1',
            external_order_id: 'ORD-1',
            merchant: { id: 'm-1', current_name: 'A', rif: 'J-1' },
            purchase_date: new Date('2026-04-01'),
            max_due_date: new Date('2026-05-15'),
            installments: [
              {
                installment_number: 1,
                amount: D('100'),
                due_date: new Date('2026-05-01'),
                status: 'pending',
              },
            ],
          },
        },
      ],
      certificate_events: [
        {
          id: 'evt-1',
          event_type: 'created',
          occurred_at: new Date(),
          payload: {},
          actor_id: 'a-1',
        },
      ],
    });
    const svc = new CertificatesService(prisma, makeAudit());
    const r = await svc.detail('cert-1', 'admin');
    expect(r.orders).toHaveLength(1);
    expect(r.orders[0]!.installments).toHaveLength(1);
    expect(r.events[0]!.event_type).toBe('created');
  });

  it('throws 404 when not found', async () => {
    const prisma = makePrismaForListDetail();
    (prisma.certificate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const svc = new CertificatesService(prisma, makeAudit());
    await expect(svc.detail('missing', 'admin')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws 404 when soft-deleted and role lacks read_deleted', async () => {
    const prisma = makePrismaForListDetail();
    (prisma.certificate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...fakeCertRow(),
      deleted_at: new Date('2026-04-30T00:00:00Z'),
      certificate_orders: [],
      certificate_events: [],
    });
    (prisma.rolePermission.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const svc = new CertificatesService(prisma, makeAudit());
    await expect(svc.detail('cert-1', 'operator')).rejects.toBeInstanceOf(NotFoundException);
  });
});

function makePrismaForCancel(
  opts: {
    cert?: {
      id: string;
      certificate_code: string;
      status: string;
      certificate_type: string;
      deleted_at: Date | null;
    } | null;
    certRow?: {
      id: string;
      certificate_code: string | null;
      status: string;
      certificate_type: string;
      deleted_at: Date | null;
    } | null;
    ownerRow?: Array<{ issued_by_id: string }>;
    certOrders?: Array<{ id?: string; order_id: string }>;
  } = {},
) {
  // Support both `cert` (legacy) and `certRow` (new draft tests) option names
  const certData = opts.certRow !== undefined ? opts.certRow : opts.cert;
  const tx = {
    $queryRaw: vi.fn().mockImplementation(async (template: unknown) => {
      const sql = Array.isArray((template as { strings?: string[] }).strings)
        ? (template as { strings: string[] }).strings.join('?')
        : Array.isArray(template)
          ? (template as string[]).join('?')
          : String(template);
      if (sql.includes('FROM cfb.certificates') && sql.includes('FOR UPDATE')) {
        return certData ? [certData] : [];
      }
      if (sql.includes('FROM cfb.certificates') && !sql.includes('FOR UPDATE')) {
        // owner lookup for draft cancel
        return opts.ownerRow ?? (certData ? [{ issued_by_id: 'op-1' }] : []);
      }
      if (sql.includes('FROM cfb.certificate_orders') && sql.includes('FOR UPDATE')) {
        return opts.certOrders ?? [];
      }
      return [];
    }),
    certificate: { update: vi.fn().mockResolvedValue({}) },
    certificateOrder: {
      updateMany: vi.fn().mockResolvedValue({ count: opts.certOrders?.length ?? 0 }),
    },
    order: { updateMany: vi.fn().mockResolvedValue({ count: opts.certOrders?.length ?? 0 }) },
    certificateEvent: { create: vi.fn().mockResolvedValue({ id: 'evt-1' }) },
    rolePermission: {
      findFirst: vi.fn().mockResolvedValue({ id: 'rp-1' }), // admin has cert.cancel by default
    },
  };
  const prisma = {
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    ...tx,
  } as unknown as PrismaService;
  (prisma as unknown as { _tx: typeof tx })._tx = tx;
  return prisma;
}

describe('CertificatesService.cancel', () => {
  it('happy path: marks cert cancelled, releases cert_orders, frees orders, inserts event, audits', async () => {
    const cert = {
      id: 'cert-1',
      certificate_code: 'C4572A',
      status: 'issued',
      certificate_type: 'standard',
      deleted_at: null,
    };
    const certOrders = [
      { id: 'co-1', order_id: 'o-a' },
      { id: 'co-2', order_id: 'o-b' },
    ];
    const prisma = makePrismaForCancel({ cert, certOrders });
    const audit = makeAudit();
    const svc = new CertificatesService(prisma, audit);

    const r = await svc.cancel('cert-1', 'Operator entered wrong rate', 'actor-1', 'admin');

    const tx = (
      prisma as unknown as {
        _tx: {
          certificate: { update: ReturnType<typeof vi.fn> };
          certificateOrder: { updateMany: ReturnType<typeof vi.fn> };
          order: { updateMany: ReturnType<typeof vi.fn> };
          certificateEvent: { create: ReturnType<typeof vi.fn> };
        };
      }
    )._tx;

    expect(tx.certificate.update).toHaveBeenCalledOnce();
    const updateArg = tx.certificate.update.mock.calls[0]![0] as {
      where: { id: string };
      data: {
        status: string;
        cancelled_at: Date;
        cancellation_reason: string;
        deleted_at: Date;
        deleted_by_id: string;
        deleted_reason: string;
      };
    };
    expect(updateArg.where.id).toBe('cert-1');
    expect(updateArg.data.status).toBe('cancelled');
    expect(updateArg.data.cancelled_at).toBeInstanceOf(Date);
    expect(updateArg.data.cancellation_reason).toBe('Operator entered wrong rate');
    expect(updateArg.data.deleted_by_id).toBe('actor-1');
    expect(updateArg.data.deleted_reason).toBe('Operator entered wrong rate');

    expect(tx.certificateOrder.updateMany).toHaveBeenCalledOnce();
    const coUpdate = tx.certificateOrder.updateMany.mock.calls[0]![0] as {
      where: { certificate_id: string; released_at: null };
      data: { released_at: Date; released_reason: string };
    };
    expect(coUpdate.where.certificate_id).toBe('cert-1');
    expect(coUpdate.data.released_reason).toContain('Operator entered wrong rate');

    expect(tx.order.updateMany).toHaveBeenCalledOnce();
    const orderUpdate = tx.order.updateMany.mock.calls[0]![0] as {
      where: { id: { in: string[] } };
      data: { status: string };
    };
    expect(orderUpdate.where.id.in).toEqual(['o-a', 'o-b']);
    expect(orderUpdate.data.status).toBe('available');

    expect(tx.certificateEvent.create).toHaveBeenCalledOnce();
    const evtArg = tx.certificateEvent.create.mock.calls[0]![0] as {
      data: { event_type: string; payload: { reason: string; order_count: number } };
    };
    expect(evtArg.data.event_type).toBe('cancelled');
    expect(evtArg.data.payload.order_count).toBe(2);

    expect(audit.recordChange).toHaveBeenCalledOnce();
    const auditArg = (audit.recordChange as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      payload: { from_status: string };
    };
    expect(auditArg.payload.from_status).toBe('issued');
    expect(r).toMatchObject({
      id: 'cert-1',
      certificate_code: 'C4572A',
      status: 'cancelled',
      released_order_count: 2,
    });
    expect(r.cancelled_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('throws 404 when cert id not found', async () => {
    const prisma = makePrismaForCancel({ cert: null });
    const svc = new CertificatesService(prisma, makeAudit());
    await expect(svc.cancel('missing', 'Reason here', 'actor-1', 'admin')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws 404 when cert is already cancelled (deleted_at IS NOT NULL)', async () => {
    const cert = {
      id: 'cert-1',
      certificate_code: 'C4572A',
      status: 'cancelled',
      certificate_type: 'standard',
      deleted_at: new Date('2026-04-30'),
    };
    const prisma = makePrismaForCancel({ cert });
    const svc = new CertificatesService(prisma, makeAudit());
    await expect(svc.cancel('cert-1', 'Reason here', 'actor-1', 'admin')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws 409 with current_status when cert is matured', async () => {
    const cert = {
      id: 'cert-1',
      certificate_code: 'C4572A',
      status: 'matured',
      certificate_type: 'standard',
      deleted_at: null,
    };
    const prisma = makePrismaForCancel({ cert });
    const svc = new CertificatesService(prisma, makeAudit());
    await expect(svc.cancel('cert-1', 'Reason here', 'actor-1', 'admin')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('CertificatesService.cancel(draft)', () => {
  it('creator can cancel their own draft', async () => {
    const prisma = makePrismaForCancel({
      certRow: {
        id: 'c-1',
        certificate_code: null,
        status: 'draft',
        certificate_type: 'standard',
        deleted_at: null,
      },
      ownerRow: [{ issued_by_id: 'op-1' }],
      certOrders: [{ order_id: 'o-1' }, { order_id: 'o-2' }],
    });
    const audit = makeAudit();
    const svc = new CertificatesService(prisma, audit);

    const result = await svc.cancel('c-1', undefined, 'op-1', 'operator');

    expect(result.status).toBe('cancelled');
    const tx = (prisma as unknown as { _tx: { certificate: { update: ReturnType<typeof vi.fn> } } })
      ._tx;
    const updateArg = tx.certificate.update.mock.calls[0]![0];
    expect(updateArg.data.status).toBe('cancelled');
    expect(updateArg.data.cancelled_at).toBeInstanceOf(Date);
    expect(updateArg.data.cancellation_reason).toBeNull();
    expect(updateArg.data.deleted_at).toBeUndefined();
  });

  it('admin can cancel any draft', async () => {
    const prisma = makePrismaForCancel({
      certRow: {
        id: 'c-1',
        certificate_code: null,
        status: 'draft',
        certificate_type: 'standard',
        deleted_at: null,
      },
      ownerRow: [{ issued_by_id: 'op-1' }],
      certOrders: [{ order_id: 'o-1' }],
    });
    const audit = makeAudit();
    const svc = new CertificatesService(prisma, audit);

    await svc.cancel('c-1', 'wrong rate', 'admin-1', 'admin');

    const tx = (prisma as unknown as { _tx: { certificate: { update: ReturnType<typeof vi.fn> } } })
      ._tx;
    expect(tx.certificate.update.mock.calls[0]![0].data.cancellation_reason).toBe('wrong rate');
  });

  it('non-creator non-admin operator cannot cancel a draft', async () => {
    const prisma = makePrismaForCancel({
      certRow: {
        id: 'c-1',
        certificate_code: null,
        status: 'draft',
        certificate_type: 'standard',
        deleted_at: null,
      },
      ownerRow: [{ issued_by_id: 'op-1' }],
      certOrders: [],
    });
    const svc = new CertificatesService(prisma, makeAudit());

    await expect(svc.cancel('c-1', undefined, 'op-2', 'operator')).rejects.toThrow(
      'Solo el creador del borrador o un admin puede cancelarlo',
    );
  });

  it('rejects cancel on already cancelled cert', async () => {
    const prisma = makePrismaForCancel({
      certRow: {
        id: 'c-1',
        certificate_code: 'C0001A',
        status: 'cancelled',
        certificate_type: 'standard',
        deleted_at: null,
      },
    });
    const svc = new CertificatesService(prisma, makeAudit());
    await expect(svc.cancel('c-1', undefined, 'admin-1', 'admin')).rejects.toThrow(
      /status actual: cancelled/,
    );
  });
});

describe('CertificatesService.list with hasReadDeleted gate', () => {
  function makePrismaForListReadDeleted(grantsReadDeleted: boolean) {
    return {
      certificate: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
      rolePermission: {
        findFirst: vi.fn().mockResolvedValue(grantsReadDeleted ? { id: 'rp-1' } : null),
      },
    } as unknown as PrismaService;
  }

  it('omits deleted_at filter when include_deleted=true AND role grants certificate.read_deleted', async () => {
    const prisma = makePrismaForListReadDeleted(true);
    const svc = new CertificatesService(prisma, makeAudit());
    await svc.list(
      { limit: 50, offset: 0, sort: 'issue_date_desc', include_deleted: true },
      'admin',
    );
    const call = (prisma.certificate.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.where.deleted_at).toBeUndefined();
  });

  it('keeps deleted_at: null filter when include_deleted=true BUT role lacks certificate.read_deleted', async () => {
    const prisma = makePrismaForListReadDeleted(false);
    const svc = new CertificatesService(prisma, makeAudit());
    await svc.list(
      { limit: 50, offset: 0, sort: 'issue_date_desc', include_deleted: true },
      'operator',
    );
    const call = (prisma.certificate.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.where.deleted_at).toBeNull();
  });
});

describe('CertificatesService.detail with hasReadDeleted gate', () => {
  function makePrismaForDetailReadDeleted(grantsReadDeleted: boolean, deletedAt: Date | null) {
    return {
      certificate: {
        findUnique: vi.fn().mockResolvedValue({
          ...fakeCertRow(),
          deleted_at: deletedAt,
          deleted_reason: deletedAt ? 'reason' : null,
          deleted_by: deletedAt ? { id: 'u-1', email: 'a@b.com', full_name: 'Admin' } : null,
          certificate_orders: [],
          certificate_events: [],
        }),
      },
      rolePermission: {
        findFirst: vi.fn().mockResolvedValue(grantsReadDeleted ? { id: 'rp-1' } : null),
      },
    } as unknown as PrismaService;
  }

  it('throws 404 when cert is cancelled and role lacks certificate.read_deleted', async () => {
    const prisma = makePrismaForDetailReadDeleted(false, new Date('2026-04-30'));
    const svc = new CertificatesService(prisma, makeAudit());
    await expect(svc.detail('cert-1', 'operator')).rejects.toBeInstanceOf(NotFoundException);
  });
});

function makePrismaForApprove(
  opts: {
    certRow?: {
      id: string;
      status: string;
      certificate_code: string | null;
      certificate_type: string;
      deleted_at: Date | null;
    } | null;
    nextCode?: string;
    certOrders?: Array<{ order_id: string }>;
  } = {},
) {
  const certRow =
    opts.certRow === undefined
      ? {
          id: 'c-1',
          status: 'draft',
          certificate_code: null,
          certificate_type: 'standard',
          deleted_at: null,
        }
      : opts.certRow;
  const tx = {
    $queryRaw: vi.fn().mockImplementation(async (template: unknown) => {
      const sql = Array.isArray((template as { strings?: string[] }).strings)
        ? (template as { strings: string[] }).strings.join('?')
        : Array.isArray(template)
          ? (template as string[]).join('?')
          : String(template);
      if (sql.includes('FROM cfb.certificates')) {
        return certRow ? [certRow] : [];
      }
      if (sql.includes('next_certificate_code')) {
        return [{ code: opts.nextCode ?? 'C4572A' }];
      }
      return [];
    }),
    certificate: {
      update: vi.fn().mockResolvedValue({}),
    },
    certificateOrder: {
      findMany: vi.fn().mockResolvedValue(opts.certOrders ?? []),
    },
    order: {
      updateMany: vi.fn().mockResolvedValue({ count: opts.certOrders?.length ?? 0 }),
    },
    certificateEvent: {
      create: vi.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
  } as unknown as PrismaService;
  (prisma as unknown as { _tx: typeof tx })._tx = tx;
  return prisma;
}

describe('CertificatesService.approve', () => {
  it('promotes draft to issued, assigns code, flips orders to assigned, writes event + audit', async () => {
    const prisma = makePrismaForApprove({
      certRow: {
        id: 'c-1',
        status: 'draft',
        certificate_code: null,
        certificate_type: 'standard',
        deleted_at: null,
      },
      nextCode: 'C4572A',
      certOrders: [{ order_id: 'o-1' }, { order_id: 'o-2' }],
    });
    const audit = makeAudit();
    const svc = new CertificatesService(prisma, audit);

    const result = await svc.approve('c-1', 'admin-1');

    expect(result.status).toBe('issued');
    expect(result.certificate_code).toBe('C4572A');

    const tx = (prisma as unknown as { _tx: any })._tx;
    expect(tx.certificate.update).toHaveBeenCalledOnce();
    const updateArg = tx.certificate.update.mock.calls[0]![0];
    expect(updateArg.data.status).toBe('issued');
    expect(updateArg.data.certificate_code).toBe('C4572A');
    expect(updateArg.data.approved_by_id).toBe('admin-1');
    expect(updateArg.data.approved_at).toBeInstanceOf(Date);

    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['o-1', 'o-2'] } },
      data: { status: 'assigned' },
    });

    expect(tx.certificateEvent.create).toHaveBeenCalledOnce();
    const eventArg = tx.certificateEvent.create.mock.calls[0]![0];
    expect(eventArg.data.event_type).toBe('approved');
    expect(eventArg.data.actor_id).toBe('admin-1');

    expect(audit.recordChange).toHaveBeenCalledOnce();
    const auditArg = (audit.recordChange as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(auditArg.action).toBe('approve');
    expect(auditArg.payload).toMatchObject({
      before: { status: 'draft' },
      after: { status: 'issued', certificate_code: 'C4572A' },
    });
  });

  it('rejects approve when cert not in draft', async () => {
    const prisma = makePrismaForApprove({
      certRow: {
        id: 'c-1',
        status: 'issued',
        certificate_code: 'C0001A',
        certificate_type: 'standard',
        deleted_at: null,
      },
    });
    const svc = new CertificatesService(prisma, makeAudit());
    await expect(svc.approve('c-1', 'admin-1')).rejects.toThrow(/status actual: issued/);
  });

  it('throws NotFoundException when cert does not exist', async () => {
    const prisma = makePrismaForApprove({ certRow: null });
    const svc = new CertificatesService(prisma, makeAudit());
    await expect(svc.approve('c-missing', 'admin-1')).rejects.toThrow('Certificado no encontrado');
  });
});
