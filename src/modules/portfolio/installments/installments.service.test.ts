import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { InstallmentsService } from './installments.service';
import { PrismaService } from '../../../prisma/prisma.service';

function makePrisma() {
  return {
    installment: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  } as unknown as PrismaService;
}

describe('InstallmentsService.list', () => {
  it('returns paginated mapped installments', async () => {
    const prisma = makePrisma();
    (prisma.installment.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: 'i-1',
        external_installment_id: 'I-1',
        order_id: 'o-1',
        installment_number: 1,
        amount: new Prisma.Decimal('75.00'),
        due_date: new Date('2026-04-15'),
        status: 'pending',
        paid_amount: null,
        order: { external_order_id: 'ORD-1', merchant: { current_name: 'Mercantil', rif: 'J-1' } },
      },
    ]);
    (prisma.installment.count as ReturnType<typeof vi.fn>).mockResolvedValueOnce(1);
    const svc = new InstallmentsService(prisma);
    const r = await svc.list({ limit: 50, offset: 0, sort: 'due_date_asc' });
    expect(r.total).toBe(1);
    expect(r.data[0]!.amount).toBe('75.0000');
    expect(r.data[0]!.order.external_order_id).toBe('ORD-1');
  });

  it('passes status + due_date range filters', async () => {
    const prisma = makePrisma();
    const svc = new InstallmentsService(prisma);
    await svc.list({
      limit: 50, offset: 0, sort: 'due_date_asc',
      status: 'pending',
      due_date_from: new Date('2026-04-01'),
      due_date_to: new Date('2026-05-01'),
    });
    const call = (prisma.installment.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.where).toEqual({
      status: 'pending',
      due_date: { gte: new Date('2026-04-01'), lte: new Date('2026-05-01') },
    });
  });

  it('honors amount_desc sort', async () => {
    const prisma = makePrisma();
    const svc = new InstallmentsService(prisma);
    await svc.list({ limit: 50, offset: 0, sort: 'amount_desc' });
    const call = (prisma.installment.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.orderBy).toEqual([{ amount: 'desc' }]);
  });
});
