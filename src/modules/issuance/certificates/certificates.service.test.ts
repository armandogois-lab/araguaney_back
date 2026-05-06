import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CertificatesService } from './certificates.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';

const D = (s: string) => new Prisma.Decimal(s);

function fakeInvestor(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-1', legal_name: 'Inversora Alpha', rif: 'J-12345678-9',
    kind: 'juridica', status: 'active',
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
      investor_id: 'inv-1', capital: 100, rate: 0.13, term_days: 42,
      issue_date: new Date('2026-05-15'),
    });

    expect(r.rules_check).toEqual({ maturity_boundary: true, order_indivisibility: true, round_down: true });
    expect(r.pool.order_count).toBe(2);
    expect(r.payouts.nominal_actual).toBe('100.0000');
    expect(r.payload_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('throws 404 when investor not found', async () => {
    const prisma = makePrismaForSimulate();
    (prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const svc = new CertificatesService(prisma, makeAudit());
    await expect(svc.simulate({
      investor_id: 'missing', capital: 100, rate: 0.13, term_days: 42,
      issue_date: new Date('2026-05-15'),
    })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws 400 when investor.kind=internal', async () => {
    const prisma = makePrismaForSimulate();
    (prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeInvestor({ kind: 'internal' }));
    const svc = new CertificatesService(prisma, makeAudit());
    await expect(svc.simulate({
      investor_id: 'inv-1', capital: 100, rate: 0.13, term_days: 42,
      issue_date: new Date('2026-05-15'),
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws 400 when investor.status=inactive', async () => {
    const prisma = makePrismaForSimulate();
    (prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeInvestor({ status: 'inactive' }));
    const svc = new CertificatesService(prisma, makeAudit());
    await expect(svc.simulate({
      investor_id: 'inv-1', capital: 100, rate: 0.13, term_days: 42,
      issue_date: new Date('2026-05-15'),
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws 422 when no eligible orders fit', async () => {
    const prisma = makePrismaForSimulate();
    (prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeInvestor());
    (prisma.order.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const svc = new CertificatesService(prisma, makeAudit());
    await expect(svc.simulate({
      investor_id: 'inv-1', capital: 100, rate: 0.13, term_days: 42,
      issue_date: new Date('2026-05-15'),
    })).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('payload_hash is deterministic across two simulate calls with same inputs', async () => {
    const prisma = makePrismaForSimulate();
    const setup = () => {
      (prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeInvestor());
      (prisma.order.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([fakeOrder('a', '60', 7)]);
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
      investor_id: 'inv-1', capital: 100, rate: 0.13, term_days: 42,
      issue_date: new Date('2026-05-15'),
    });
    setup();
    const r2 = await svc.simulate({
      investor_id: 'inv-1', capital: 100, rate: 0.13, term_days: 42,
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
      investor_id: 'inv-1', capital: 100, rate: 0.13, term_days: 42,
      issue_date: new Date('2026-05-15'),
    });
    expect(r.concentration.total_distinct_merchants).toBe(2);
    expect(r.concentration.top[0]!.merchant_id).toBe('big');
    expect(r.concentration.top[0]!.amount).toBe('70.0000');
  });
});

function makePrismaForIssue(opts: {
  investor?: Record<string, unknown> | null;
  lockedOrders?: Array<{ id: string; installments_sum: Prisma.Decimal; max_due_date: Date; merchant_id: string; status: string; external_order_id?: string }>;
  certificateCode?: string;
} = {}) {
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
        id: 'cert-1', ...(data as object),
      })),
    },
    certificateOrder: { createMany: vi.fn().mockResolvedValue({ count: opts.lockedOrders?.length ?? 0 }) },
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
      { id: 'o-a', installments_sum: D('60'), max_due_date: new Date('2026-05-22'), merchant_id: 'm-a', status: 'available' },
      { id: 'o-b', installments_sum: D('40'), max_due_date: new Date('2026-05-29'), merchant_id: 'm-b', status: 'available' },
    ];
    const prisma = makePrismaForIssue({ lockedOrders });

    const audit = makeAudit();
    const svc = new CertificatesService(prisma, audit);
    // Pre-run simulate to get expected_payload_hash
    (prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeInvestor());
    (prisma.order.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      lockedOrders.map((o) => ({ ...o, external_order_id: `ORD-${o.id}`, num_installments: 3, purchase_date: new Date('2026-04-01') })),
    );
    (prisma.merchant.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'm-a', current_name: 'A', rif: 'J-1' }, { id: 'm-b', current_name: 'B', rif: 'J-2' },
    ]);
    (prisma.installment.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const sim = await svc.simulate({
      investor_id: 'inv-1', capital: 100, rate: 0.13, term_days: 42,
      issue_date: new Date('2026-05-15'),
    });
    const expectedHash = sim.payload_hash;
    const orderIds = sim.pool.order_ids;

    const result = await svc.issue({
      investor_id: 'inv-1', capital: 100, rate: 0.13, term_days: 42,
      issue_date: new Date('2026-05-15'),
      order_ids: orderIds,
      expected_payload_hash: expectedHash,
    }, 'actor-1');

    const tx = (prisma as unknown as { _tx: { certificate: { create: ReturnType<typeof vi.fn> }; certificateOrder: { createMany: ReturnType<typeof vi.fn> }; order: { updateMany: ReturnType<typeof vi.fn> }; certificateEvent: { create: ReturnType<typeof vi.fn> } } })._tx;
    expect(tx.certificate.create).toHaveBeenCalledOnce();
    expect(tx.certificateOrder.createMany).toHaveBeenCalledOnce();
    expect(tx.order.updateMany).toHaveBeenCalledOnce();
    expect(tx.certificateEvent.create).toHaveBeenCalledOnce();
    expect(audit.recordChange).toHaveBeenCalledOnce();
    expect((result as { id: string }).id).toBe('cert-1');
  });

  it('throws 409 when one of the locked orders has status != available', async () => {
    const lockedOrders = [
      { id: 'o-a', installments_sum: D('60'), max_due_date: new Date('2026-05-22'), merchant_id: 'm-a', status: 'assigned' },
    ];
    const prisma = makePrismaForIssue({ lockedOrders });
    const svc = new CertificatesService(prisma, makeAudit());
    await expect(svc.issue({
      investor_id: 'inv-1', capital: 100, rate: 0.13, term_days: 42,
      issue_date: new Date('2026-05-15'),
      order_ids: ['o-a'],
      expected_payload_hash: 'a'.repeat(64),
    }, 'actor-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws 409 when one of the order_ids does not exist', async () => {
    const prisma = makePrismaForIssue({ lockedOrders: [] });
    const svc = new CertificatesService(prisma, makeAudit());
    await expect(svc.issue({
      investor_id: 'inv-1', capital: 100, rate: 0.13, term_days: 42,
      issue_date: new Date('2026-05-15'),
      order_ids: ['ghost'],
      expected_payload_hash: 'a'.repeat(64),
    }, 'actor-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws 422 when expected_payload_hash does not match recomputed', async () => {
    const lockedOrders = [
      { id: 'o-a', installments_sum: D('60'), max_due_date: new Date('2026-05-22'), merchant_id: 'm-a', status: 'available' },
    ];
    const prisma = makePrismaForIssue({ lockedOrders });
    const svc = new CertificatesService(prisma, makeAudit());
    await expect(svc.issue({
      investor_id: 'inv-1', capital: 100, rate: 0.13, term_days: 42,
      issue_date: new Date('2026-05-15'),
      order_ids: ['o-a'],
      expected_payload_hash: 'b'.repeat(64),
    }, 'actor-1')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('throws 422 when client order_ids do not match recomputed pool', async () => {
    const lockedOrders = [
      { id: 'o-a', installments_sum: D('500'), max_due_date: new Date('2026-05-22'), merchant_id: 'm-a', status: 'available' },
    ];
    const prisma = makePrismaForIssue({ lockedOrders });
    const svc = new CertificatesService(prisma, makeAudit());
    await expect(svc.issue({
      investor_id: 'inv-1', capital: 100, rate: 0.13, term_days: 42,
      issue_date: new Date('2026-05-15'),
      order_ids: ['o-a'],   // 500 > target ~101.54 → recomputed pool would be empty, mismatch
      expected_payload_hash: 'a'.repeat(64),
    }, 'actor-1')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('throws 422 when MAX(max_due_date) > maturity_date', async () => {
    const lockedOrders = [
      { id: 'o-a', installments_sum: D('60'), max_due_date: new Date('2027-12-31'), merchant_id: 'm-a', status: 'available' },
    ];
    const prisma = makePrismaForIssue({ lockedOrders });
    const svc = new CertificatesService(prisma, makeAudit());
    await expect(svc.issue({
      investor_id: 'inv-1', capital: 100, rate: 0.13, term_days: 42,
      issue_date: new Date('2026-05-15'),
      order_ids: ['o-a'],
      expected_payload_hash: 'a'.repeat(64),
    }, 'actor-1')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('inserts certificate_event with event_type=created and updates orders to assigned', async () => {
    const lockedOrders = [
      { id: 'o-a', installments_sum: D('60'), max_due_date: new Date('2026-05-22'), merchant_id: 'm-a', status: 'available' },
    ];
    const prisma = makePrismaForIssue({ lockedOrders });
    const audit = makeAudit();
    const svc = new CertificatesService(prisma, audit);
    // Pre-simulate to get hash
    (prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeInvestor());
    (prisma.order.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      lockedOrders.map((o) => ({ ...o, external_order_id: `ORD-${o.id}`, num_installments: 3, purchase_date: new Date('2026-04-01') })),
    );
    (prisma.merchant.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'm-a', current_name: 'A', rif: 'J-1' },
    ]);
    (prisma.installment.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const sim = await svc.simulate({
      investor_id: 'inv-1', capital: 100, rate: 0.13, term_days: 42,
      issue_date: new Date('2026-05-15'),
    });

    await svc.issue({
      investor_id: 'inv-1', capital: 100, rate: 0.13, term_days: 42,
      issue_date: new Date('2026-05-15'),
      order_ids: sim.pool.order_ids,
      expected_payload_hash: sim.payload_hash,
    }, 'actor-1');

    const tx = (prisma as unknown as { _tx: { certificateEvent: { create: ReturnType<typeof vi.fn> }; order: { updateMany: ReturnType<typeof vi.fn> } } })._tx;
    const evtCall = tx.certificateEvent.create.mock.calls[0]![0] as { data: { event_type: string; payload: unknown } };
    expect(evtCall.data.event_type).toBe('created');
    const updCall = tx.order.updateMany.mock.calls[0]![0] as { where: { id: { in: string[] } }; data: { status: string } };
    expect(updCall.data.status).toBe('assigned');
    expect(updCall.where.id.in).toEqual(['o-a']);
  });
});
