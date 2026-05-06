import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { OrdersListQuery, OrdersStatsQuery } from './orders.dto';
import { toOrderSummary, type OrderSummaryRow } from './responses/order-summary.mapper';
import { toOrderDetail, type OrderDetailRow } from './responses/order-detail.mapper';
import { toOrderStats, type StatsGroupRow } from './responses/order-stats.mapper';

const SORT_MAP = {
  purchase_date_desc: [{ purchase_date: 'desc' as const }],
  purchase_date_asc: [{ purchase_date: 'asc' as const }],
  max_due_date_asc: [{ max_due_date: 'asc' as const }],
  max_due_date_desc: [{ max_due_date: 'desc' as const }],
};

/**
 * Prisma relation name is `batch` (singular) but the mapper type `OrderSummaryRow`
 * expects `batches` (the field name used in early mapper design). We remap here
 * so the mapper stays stable and the DB query uses the correct relation name.
 */
function normalizeBatch<T extends { batch?: unknown; batches?: unknown }>(
  row: T,
): Omit<T, 'batch'> & { batches: unknown } {
  const { batch, ...rest } = row as T & { batch?: unknown };
  return { ...rest, batches: batch ?? (row as T & { batches?: unknown }).batches };
}

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: OrdersListQuery) {
    const where = this.buildWhere(query);
    if (query.q) {
      where.external_order_id = { contains: query.q, mode: 'insensitive' };
    }
    const orderBy = SORT_MAP[query.sort];
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: { merchant: true, end_user: true, batch: true },
        orderBy,
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.order.count({ where }),
    ]);
    return {
      data: rows.map((r) => toOrderSummary(normalizeBatch(r) as unknown as OrderSummaryRow)),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async detail(id: string) {
    const row = await this.prisma.order.findUnique({
      where: { id },
      include: {
        merchant: true,
        end_user: true,
        batch: true,
        installments: { orderBy: { installment_number: 'asc' } },
        order_events: { orderBy: { occurred_at: 'desc' }, take: 50 },
      },
    });
    if (!row) throw new NotFoundException('Orden no encontrada');
    return toOrderDetail(normalizeBatch(row) as unknown as OrderDetailRow);
  }

  async stats(query: OrdersStatsQuery) {
    const where = this.buildWhere(query);
    const rows = await this.prisma.order.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
      _sum: { total_amount: true, installments_sum: true },
    });
    return toOrderStats(rows as unknown as StatsGroupRow[]);
  }

  private buildWhere(q: OrdersStatsQuery): Prisma.OrderWhereInput {
    const where: Prisma.OrderWhereInput = {};
    if (q.status) where.status = q.status;
    if (q.merchant_id) where.merchant_id = q.merchant_id;
    if (q.end_user_id) where.end_user_id = q.end_user_id;
    if (q.batch_id) where.batch_id = q.batch_id;
    if (q.purchase_date_from || q.purchase_date_to) {
      where.purchase_date = {};
      if (q.purchase_date_from)
        (where.purchase_date as Record<string, Date>).gte = q.purchase_date_from;
      if (q.purchase_date_to)
        (where.purchase_date as Record<string, Date>).lte = q.purchase_date_to;
    }
    if (q.max_due_date_lte) where.max_due_date = { lte: q.max_due_date_lte };
    return where;
  }
}
