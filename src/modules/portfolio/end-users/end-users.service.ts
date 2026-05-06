import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { EndUsersListQuery, EndUserUpdate } from './end-users.dto';
import { toEndUserSummary } from './responses/end-user-summary.mapper';
import { toEndUserDetail } from './responses/end-user-detail.mapper';

const SORT_MAP = {
  last_seen_desc: [{ last_seen_at: 'desc' as const }],
  first_seen_desc: [{ first_seen_at: 'desc' as const }],
  external_hash_asc: [{ external_hash: 'asc' as const }],
};

const EDITABLE = ['full_name', 'national_id', 'email', 'phone'] as const;

@Injectable()
export class EndUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: EndUsersListQuery) {
    const where: Prisma.EndUserWhereInput = {};
    if (query.q) {
      where.OR = [
        { external_hash: { contains: query.q, mode: 'insensitive' } },
        { full_name: { contains: query.q, mode: 'insensitive' } },
        { national_id: { contains: query.q, mode: 'insensitive' } },
        { email: { contains: query.q, mode: 'insensitive' } },
        { phone: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    if (query.has_national_id !== undefined) {
      where.national_id = query.has_national_id ? { not: null } : null;
    }
    const [rows, total] = await Promise.all([
      this.prisma.endUser.findMany({
        where,
        include: { _count: { select: { orders: true } } },
        orderBy: SORT_MAP[query.sort],
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.endUser.count({ where }),
    ]);
    return {
      data: rows.map((r) => toEndUserSummary(r as never)),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async detail(id: string) {
    const u = await this.prisma.endUser.findUnique({
      where: { id },
      include: { _count: { select: { orders: true } } },
    });
    if (!u) throw new NotFoundException('End user no encontrado');

    const [statuses, agg] = await Promise.all([
      this.prisma.order.groupBy({ by: ['status'], where: { end_user_id: id }, _count: { _all: true } }),
      this.prisma.order.aggregate({ where: { end_user_id: id }, _sum: { total_amount: true } }),
    ]);
    const ordersByStatus: Record<string, number> = {};
    for (const s of statuses) ordersByStatus[s.status] = s._count._all;
    const ordersTotalAmount = (agg._sum.total_amount ?? new Prisma.Decimal(0)).toFixed(4);

    return toEndUserDetail({ ...u, ordersByStatus, ordersTotalAmount } as never);
  }

  async update(opts: { id: string; patch: EndUserUpdate; actorId: string }) {
    return await this.prisma.$transaction(async (tx) => {
      const before = await tx.endUser.findUnique({
        where: { id: opts.id },
        include: { _count: { select: { orders: true } } },
      });
      if (!before) throw new NotFoundException('End user no encontrado');

      const diff: Record<string, string | null> = {};
      for (const k of EDITABLE) {
        if (k in opts.patch) {
          const next = opts.patch[k] ?? null;
          if (next !== (before as Record<string, unknown>)[k]) {
            diff[k] = next;
          }
        }
      }
      if (Object.keys(diff).length === 0) {
        return await this.detailAggregates(tx, before as never);
      }

      const updated = await tx.endUser.update({
        where: { id: opts.id },
        data: { ...diff, enriched_at: new Date() },
        include: { _count: { select: { orders: true } } },
      });

      const beforeSlice: Record<string, unknown> = {};
      const afterSlice: Record<string, unknown> = {};
      for (const k of Object.keys(diff)) {
        beforeSlice[k] = (before as Record<string, unknown>)[k];
        afterSlice[k] = (updated as Record<string, unknown>)[k];
      }

      await this.audit.recordChange({
        entityType: 'end_user',
        entityId: opts.id,
        action: 'update',
        actorId: opts.actorId,
        payload: { before: beforeSlice, after: afterSlice },
        tx,
      });

      return await this.detailAggregates(tx, updated as never);
    });
  }

  private async detailIn(tx: Prisma.TransactionClient, id: string) {
    const u = await tx.endUser.findUnique({
      where: { id },
      include: { _count: { select: { orders: true } } },
    });
    if (!u) throw new NotFoundException('End user no encontrado');
    return await this.detailAggregates(tx, u as never);
  }

  private async detailAggregates(
    tx: Prisma.TransactionClient,
    u: { id: string; _count: { orders: number }; [key: string]: unknown },
  ) {
    const id = u.id;
    const [statuses, agg] = await Promise.all([
      tx.order.groupBy({ by: ['status'], where: { end_user_id: id }, _count: { _all: true } }),
      tx.order.aggregate({ where: { end_user_id: id }, _sum: { total_amount: true } }),
    ]);
    const ordersByStatus: Record<string, number> = {};
    for (const s of statuses) ordersByStatus[s.status] = s._count._all;
    const ordersTotalAmount = (agg._sum.total_amount ?? new Prisma.Decimal(0)).toFixed(4);

    return toEndUserDetail({ ...u, ordersByStatus, ordersTotalAmount } as never);
  }
}
