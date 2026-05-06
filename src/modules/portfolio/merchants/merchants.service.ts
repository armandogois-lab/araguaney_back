import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { MerchantsListQuery } from './merchants.dto';
import { toMerchantSummary } from './responses/merchant-summary.mapper';
import { toMerchantDetail } from './responses/merchant-detail.mapper';

const SORT_MAP = {
  name_asc: [{ current_name: 'asc' as const }],
  name_desc: [{ current_name: 'desc' as const }],
  last_seen_desc: [{ last_seen_at: 'desc' as const }],
};

@Injectable()
export class MerchantsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: MerchantsListQuery) {
    const where: Prisma.MerchantWhereInput = {};
    if (query.q) {
      where.OR = [
        { current_name: { contains: query.q, mode: 'insensitive' } },
        { rif: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.merchant.findMany({
        where,
        include: { _count: { select: { orders: true } } },
        orderBy: SORT_MAP[query.sort],
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.merchant.count({ where }),
    ]);

    const enriched = await Promise.all(
      rows.map(async (m) => {
        const agg = await this.prisma.order.aggregate({
          where: { merchant_id: m.id },
          _sum: { total_amount: true },
        });
        return toMerchantSummary({ ...m, ordersAggregateAmount: agg._sum.total_amount });
      }),
    );
    return { data: enriched, total, limit: query.limit, offset: query.offset };
  }

  async detail(id: string) {
    const m = await this.prisma.merchant.findUnique({
      where: { id },
      include: {
        _count: { select: { orders: true } },
        merchant_name_history: true,
      },
    });
    if (!m) throw new NotFoundException('Comercio no encontrado');

    const [statuses, agg] = await Promise.all([
      this.prisma.order.groupBy({ by: ['status'], where: { merchant_id: id }, _count: { _all: true } }),
      this.prisma.order.aggregate({ where: { merchant_id: id }, _sum: { total_amount: true } }),
    ]);
    const ordersByStatus: Record<string, number> = {};
    for (const s of statuses) ordersByStatus[s.status] = s._count._all;

    return toMerchantDetail({
      ...m,
      ordersAggregateAmount: agg._sum.total_amount,
      ordersByStatus,
    } as never);
  }
}
