import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OrdersService } from './orders.service';
import { PrismaService } from '../../../prisma/prisma.service';

function fakeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    external_order_id: 'ORD-1',
    status: 'available',
    purchase_date: new Date('2026-04-01'),
    max_due_date: new Date('2026-05-13'),
    total_amount: new Prisma.Decimal('300.00'),
    installments_sum: new Prisma.Decimal('300.00'),
    num_installments: 3,
    imported_at: new Date('2026-05-06T12:59:47Z'),
    merchant: { id: 'm-1', current_name: 'Mercantil C.A.', rif: 'J-12345678-9' },
    end_user: { id: 'u-1', external_hash: 'smoke-user-1', national_id: null, full_name: null },
    batches: { id: 'b-1', external_code: 'B-20260506-125940' },
    ...overrides,
  };
}

function makePrisma() {
  return {
    order: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn(),
      groupBy: vi.fn().mockResolvedValue([]),
    },
  } as unknown as PrismaService;
}

describe('OrdersService.list', () => {
  it('returns paginated data with mapped summary rows', async () => {
    const prisma = makePrisma();
    (prisma.order.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([fakeRow()]);
    (prisma.order.count as ReturnType<typeof vi.fn>).mockResolvedValueOnce(1);
    const svc = new OrdersService(prisma);

    const result = await svc.list({ limit: 50, offset: 0, sort: 'purchase_date_desc' });

    expect(result.total).toBe(1);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.external_order_id).toBe('ORD-1');
    expect(result.data[0]!.total_amount).toBe('300.0000');
  });

  it('passes filters through to prisma where clause (status + max_due_date_lte + merchant_id)', async () => {
    const prisma = makePrisma();
    const svc = new OrdersService(prisma);

    await svc.list({
      limit: 50,
      offset: 0,
      sort: 'max_due_date_asc',
      status: 'available',
      max_due_date_lte: new Date('2026-06-01'),
      merchant_id: 'm-xx',
    });

    const call = (prisma.order.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.where).toEqual({
      status: 'available',
      merchant_id: 'm-xx',
      max_due_date: { lte: new Date('2026-06-01') },
    });
    expect(call.orderBy).toEqual([{ max_due_date: 'asc' }]);
  });

  it('combines purchase_date_from/to into a range', async () => {
    const prisma = makePrisma();
    const svc = new OrdersService(prisma);
    await svc.list({
      limit: 50,
      offset: 0,
      sort: 'purchase_date_desc',
      purchase_date_from: new Date('2026-04-01'),
      purchase_date_to: new Date('2026-04-30'),
    });
    const call = (prisma.order.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.where.purchase_date).toEqual({
      gte: new Date('2026-04-01'),
      lte: new Date('2026-04-30'),
    });
  });
});

describe('OrdersService.detail', () => {
  it('returns order with installments + events', async () => {
    const prisma = makePrisma();
    (prisma.order.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...fakeRow(),
      installments: [
        {
          id: 'i-1',
          external_installment_id: 'I-1',
          installment_number: 1,
          amount: new Prisma.Decimal('75.00'),
          due_date: new Date('2026-04-15'),
          status: 'pending',
          paid_amount: null,
        },
      ],
      order_events: [],
    });
    const svc = new OrdersService(prisma);
    const r = await svc.detail('order-1');
    expect(r.installments).toHaveLength(1);
    expect(r.installments[0]!.amount).toBe('75.0000');
    expect(r.events).toHaveLength(0);
  });

  it('throws NotFoundException when order not found', async () => {
    const prisma = makePrisma();
    (prisma.order.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const svc = new OrdersService(prisma);
    await expect(svc.detail('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('OrdersService.stats', () => {
  it('aggregates groupBy result with available_capital from available bucket', async () => {
    const prisma = makePrisma();
    (prisma.order.groupBy as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        status: 'available',
        _count: { _all: 2 },
        _sum: {
          total_amount: new Prisma.Decimal('400.00'),
          installments_sum: new Prisma.Decimal('400.00'),
        },
      },
      {
        status: 'assigned',
        _count: { _all: 1 },
        _sum: {
          total_amount: new Prisma.Decimal('100.00'),
          installments_sum: new Prisma.Decimal('75.00'),
        },
      },
    ]);
    const svc = new OrdersService(prisma);
    const r = await svc.stats({});
    expect(r.total_orders).toBe(3);
    expect(r.by_status.available!.count).toBe(2);
    expect(r.by_status.matured!.count).toBe(0);
    expect(r.available_capital).toBe('400.0000');
  });
});
