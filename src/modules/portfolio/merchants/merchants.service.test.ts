import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MerchantsService } from './merchants.service';
import { PrismaService } from '../../../prisma/prisma.service';

function makePrisma() {
  return {
    merchant: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn(),
    },
    order: {
      groupBy: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue({ _sum: { total_amount: null } }),
    },
  } as unknown as PrismaService;
}

describe('MerchantsService.list', () => {
  it('returns paginated mapped merchants with order_count', async () => {
    const prisma = makePrisma();
    (prisma.merchant.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: 'm-1',
        rif: 'J-12345678-9',
        current_name: 'Mercantil',
        first_seen_at: new Date('2026-04-01'),
        last_seen_at: new Date('2026-05-06'),
        _count: { orders: 1 },
      },
    ]);
    (prisma.merchant.count as ReturnType<typeof vi.fn>).mockResolvedValueOnce(1);
    (prisma.order.aggregate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      _sum: { total_amount: new Prisma.Decimal('300.00') },
    });

    const svc = new MerchantsService(prisma);
    const r = await svc.list({ limit: 50, offset: 0, sort: 'name_asc' });
    expect(r.total).toBe(1);
    expect(r.data[0]!.order_count).toBe(1);
    expect(r.data[0]!.total_orders_amount).toBe('300.0000');
  });

  it('passes q-search across current_name and rif (case-insensitive)', async () => {
    const prisma = makePrisma();
    const svc = new MerchantsService(prisma);
    await svc.list({ limit: 50, offset: 0, sort: 'name_asc', q: 'Bodeg' });
    const call = (prisma.merchant.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.where).toEqual({
      OR: [
        { current_name: { contains: 'Bodeg', mode: 'insensitive' } },
        { rif: { contains: 'Bodeg', mode: 'insensitive' } },
      ],
    });
  });
});

describe('MerchantsService.detail', () => {
  it('returns merchant with name_history and orders_summary', async () => {
    const prisma = makePrisma();
    (prisma.merchant.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'm-1',
      rif: 'J-12345678-9',
      current_name: 'Mercantil',
      first_seen_at: new Date('2026-04-01'),
      last_seen_at: new Date('2026-05-06'),
      _count: { orders: 1 },
      merchant_name_history: [
        {
          id: 'h-1',
          name: 'Mercantil',
          effective_from: new Date('2026-04-01'),
          effective_to: null,
        },
      ],
    });
    (prisma.order.groupBy as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { status: 'available', _count: { _all: 1 } },
    ]);
    (prisma.order.aggregate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      _sum: { total_amount: new Prisma.Decimal('300.00') },
    });

    const svc = new MerchantsService(prisma);
    const r = await svc.detail('m-1');
    expect(r.name_history).toHaveLength(1);
    expect(r.orders_summary.by_status.available).toBe(1);
    expect(r.orders_summary.total_amount).toBe('300.0000');
  });

  it('throws NotFoundException when merchant not found', async () => {
    const prisma = makePrisma();
    (prisma.merchant.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const svc = new MerchantsService(prisma);
    await expect(svc.detail('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
