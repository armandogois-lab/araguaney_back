import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { InstallmentsListQuery } from './installments.dto';
import { toInstallmentSummary } from './responses/installment-summary.mapper';

const SORT_MAP = {
  due_date_asc: [{ due_date: 'asc' as const }],
  due_date_desc: [{ due_date: 'desc' as const }],
  amount_desc: [{ amount: 'desc' as const }],
};

@Injectable()
export class InstallmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: InstallmentsListQuery) {
    const where: Prisma.InstallmentWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.order_id) where.order_id = query.order_id;
    if (query.due_date_from || query.due_date_to) {
      where.due_date = {};
      if (query.due_date_from) (where.due_date as Record<string, Date>).gte = query.due_date_from;
      if (query.due_date_to) (where.due_date as Record<string, Date>).lte = query.due_date_to;
    }
    const [rows, total] = await Promise.all([
      this.prisma.installment.findMany({
        where,
        include: { order: { include: { merchant: true } } },
        orderBy: SORT_MAP[query.sort],
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.installment.count({ where }),
    ]);
    return {
      data: rows.map((r) => toInstallmentSummary(r as never)),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }
}
