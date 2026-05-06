import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuditOptions } from './types';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async recordChange(opts: AuditOptions): Promise<void> {
    const client = opts.tx ?? this.prisma;
    await client.auditLog.create({
      data: {
        entity_type: opts.entityType,
        entity_id: opts.entityId,
        action: opts.action,
        actor_id: opts.actorId,
        payload: opts.payload as Prisma.InputJsonValue,
      },
    });
  }
}
