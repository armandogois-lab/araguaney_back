import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { toAuditEntry, type AuditEntryRow } from './responses/audit-entry.mapper';
import type { AuditListQuery } from './audit.dto';

@Injectable()
export class AuditQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: AuditListQuery) {
    const where: Prisma.AuditLogWhereInput = {};
    if (query.entity_type) where.entity_type = query.entity_type;
    if (query.entity_id) where.entity_id = query.entity_id;
    if (query.actor_id) where.actor_id = query.actor_id;
    if (query.action) where.action = query.action;
    if (query.occurred_at_from || query.occurred_at_to) {
      where.occurred_at = {};
      if (query.occurred_at_from)
        (where.occurred_at as Record<string, Date>).gte = query.occurred_at_from;
      if (query.occurred_at_to)
        (where.occurred_at as Record<string, Date>).lte = query.occurred_at_to;
    }

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: { actor: true },
        orderBy: { occurred_at: 'desc' },
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data: rows.map((r) => toAuditEntry(r as unknown as AuditEntryRow)),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }
}
