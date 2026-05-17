import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { UsersListQuery } from './users.dto';

export interface UserListItem {
  id: string;
  email: string;
  full_name: string;
  role: 'operator' | 'admin' | 'auditor';
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: UsersListQuery): Promise<{ data: UserListItem[]; total: number }> {
    const where: Record<string, unknown> = {};
    if (query.q) {
      where.OR = [
        { email: { contains: query.q, mode: 'insensitive' } },
        { full_name: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    if (query.role !== undefined) where.role = query.role;
    if (query.is_active !== undefined) where.is_active = query.is_active;

    const rows = await this.prisma.user.findMany({
      where,
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        email: true,
        full_name: true,
        role: true,
        is_active: true,
        last_login_at: true,
        created_at: true,
      },
    });

    const data = rows.map((r) => ({
      id: r.id,
      email: r.email,
      full_name: r.full_name,
      role: r.role,
      is_active: r.is_active,
      last_login_at: r.last_login_at ? r.last_login_at.toISOString() : null,
      created_at: r.created_at.toISOString(),
    }));

    return { data, total: data.length };
  }

  async update(
    actorId: string,
    targetId: string,
    body: { role?: 'operator' | 'admin' | 'auditor'; is_active?: boolean },
  ): Promise<UserListItem> {
    if (actorId === targetId) {
      throw new BadRequestException('No podés modificarte a vos mismo.');
    }
    if (body.role === undefined && body.is_active === undefined) {
      throw new BadRequestException('Debés indicar al menos un cambio.');
    }

    return await this.prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: targetId },
        select: { id: true, role: true, is_active: true },
      });
      if (!target) throw new NotFoundException('Usuario no encontrado.');

      const data: Record<string, unknown> = {};
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      if (body.role !== undefined && body.role !== target.role) {
        data.role = body.role;
        before.role = target.role;
        after.role = body.role;
      }
      if (body.is_active !== undefined && body.is_active !== target.is_active) {
        data.is_active = body.is_active;
        before.is_active = target.is_active;
        after.is_active = body.is_active;
      }

      const updated = await tx.user.update({
        where: { id: targetId },
        data,
        select: {
          id: true,
          email: true,
          full_name: true,
          role: true,
          is_active: true,
          last_login_at: true,
          created_at: true,
        },
      });

      if (Object.keys(after).length > 0) {
        await this.audit.recordChange({
          entityType: 'user',
          entityId: targetId,
          action: 'update',
          actorId,
          payload: { before, after },
          tx,
        });
      }

      return {
        id: updated.id,
        email: updated.email,
        full_name: updated.full_name,
        role: updated.role,
        is_active: updated.is_active,
        last_login_at: updated.last_login_at ? updated.last_login_at.toISOString() : null,
        created_at: updated.created_at.toISOString(),
      };
    });
  }
}
