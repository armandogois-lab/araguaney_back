import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { toRolePermissionsMatrix } from './responses/role-permissions-matrix.mapper';
import type { RoleParam } from './role-permissions.dto';

@Injectable()
export class RolePermissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getMatrix() {
    const [permissions, rolePermissions] = await Promise.all([
      this.prisma.permission.findMany({
        select: { id: true, key: true, description: true },
        orderBy: { key: 'asc' },
      }),
      this.prisma.rolePermission.findMany({
        select: { role: true, permission: { select: { key: true } } },
      }),
    ]);
    return toRolePermissionsMatrix({ permissions, rolePermissions });
  }

  async grant(role: RoleParam, permissionKey: string, actorId: string) {
    const permission = await this.prisma.permission.findUnique({
      where: { key: permissionKey },
      select: { id: true },
    });
    if (!permission) {
      throw new NotFoundException('Permiso no encontrado');
    }

    return await this.prisma.$transaction(async (tx) => {
      const existing = await tx.rolePermission.findUnique({
        where: {
          role_permission_id: { role, permission_id: permission.id },
        },
      });

      if (existing) {
        return { role, permission_key: permissionKey, granted: false };
      }

      await tx.rolePermission.create({
        data: { role, permission_id: permission.id, granted_by_id: actorId },
      });

      await this.audit.recordChange({
        entityType: 'role_permission',
        entityId: `${role}:${permissionKey}`,
        action: 'grant',
        actorId,
        payload: { role, permission_key: permissionKey },
        tx,
      });

      return { role, permission_key: permissionKey, granted: true };
    });
  }

  async revoke(role: RoleParam, permissionKey: string, actorId: string) {
    if (role === 'admin' && permissionKey === 'permission.manage') {
      throw new ConflictException({
        message: 'No se puede revocar permission.manage del rol admin',
        role,
        permission_key: permissionKey,
      });
    }

    const permission = await this.prisma.permission.findUnique({
      where: { key: permissionKey },
      select: { id: true },
    });
    if (!permission) {
      // Catalog miss — idempotent: nothing to revoke.
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.rolePermission.deleteMany({
        where: { role, permission_id: permission.id },
      });

      if (deleted.count === 0) return;

      await this.audit.recordChange({
        entityType: 'role_permission',
        entityId: `${role}:${permissionKey}`,
        action: 'revoke',
        actorId,
        payload: { role, permission_key: permissionKey },
        tx,
      });
    });
  }
}
