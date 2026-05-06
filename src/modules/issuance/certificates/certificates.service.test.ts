import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
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
