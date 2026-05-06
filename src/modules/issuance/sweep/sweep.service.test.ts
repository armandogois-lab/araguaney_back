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
    // capital = 100 × price(0.08, 14d) = 100 × 0.996889 = 99.6889
    expect(r.payouts!.investor_capital).toBe('99.6889');
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
