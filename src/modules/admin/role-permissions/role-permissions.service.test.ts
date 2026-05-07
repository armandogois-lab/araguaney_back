import { describe, it, expect, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { RolePermissionsService } from './role-permissions.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';

function makeAudit() {
  return { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
}

function makePrismaForRP(opts: {
  permissionLookup?: { id: string } | null;
  existingGrant?: { role: string; permission_id: string } | null;
  permissions?: Array<{ id: string; key: string; description: string }>;
  rolePermissions?: Array<{ role: string; permission: { key: string } }>;
  deleteCount?: number;
} = {}) {
  const tx = {
    rolePermission: {
      findUnique: vi.fn().mockResolvedValue(opts.existingGrant ?? null),
      create: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: opts.deleteCount ?? 0 }),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    permission: {
      findUnique: vi.fn().mockResolvedValue(opts.permissionLookup === undefined ? { id: 'p-1' } : opts.permissionLookup),
      findMany: vi.fn().mockResolvedValue(opts.permissions ?? []),
    },
    rolePermission: {
      findMany: vi.fn().mockResolvedValue(opts.rolePermissions ?? []),
    },
  } as unknown as PrismaService;
  (prisma as unknown as { _tx: typeof tx })._tx = tx;
  return prisma;
}

describe('RolePermissionsService.getMatrix', () => {
  it('returns shape { permissions, roles, matrix } with all 3 roles populated', async () => {
    const prisma = makePrismaForRP({
      permissions: [
        { id: 'p-1', key: 'audit.read', description: 'Ver el audit_log completo' },
        { id: 'p-2', key: 'investor.read', description: 'Ver inversores' },
      ],
      rolePermissions: [
        { role: 'admin', permission: { key: 'audit.read' } },
        { role: 'operator', permission: { key: 'audit.read' } },
        { role: 'admin', permission: { key: 'investor.read' } },
      ],
    });
    const svc = new RolePermissionsService(prisma, makeAudit());
    const r = await svc.getMatrix();
    expect(r.permissions).toEqual([
      { key: 'audit.read', description: 'Ver el audit_log completo' },
      { key: 'investor.read', description: 'Ver inversores' },
    ]);
    expect(r.roles).toEqual(['operator', 'admin', 'auditor']);
    expect(r.matrix.operator).toEqual(['audit.read']);
    expect(r.matrix.admin).toEqual(['audit.read', 'investor.read']);
    expect(r.matrix.auditor).toEqual([]);
  });
});

describe('RolePermissionsService.grant', () => {
  it('happy path: creates rolePermission, audits with role_permission entity, returns granted: true', async () => {
    const prisma = makePrismaForRP({ permissionLookup: { id: 'p-1' }, existingGrant: null });
    const audit = makeAudit();
    const svc = new RolePermissionsService(prisma, audit);

    const r = await svc.grant('auditor', 'audit.read', 'actor-1');

    const tx = (prisma as unknown as {
      _tx: { rolePermission: { create: ReturnType<typeof vi.fn> } };
    })._tx;
    expect(tx.rolePermission.create).toHaveBeenCalledOnce();
    const createArg = tx.rolePermission.create.mock.calls[0]![0] as {
      data: { role: string; permission_id: string; granted_by_id: string };
    };
    expect(createArg.data).toEqual({
      role: 'auditor',
      permission_id: 'p-1',
      granted_by_id: 'actor-1',
    });

    expect(audit.recordChange).toHaveBeenCalledOnce();
    const auditArg = (audit.recordChange as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      entityType: string;
      entityId: string;
      action: string;
      payload: { role: string; permission_key: string };
    };
    expect(auditArg.entityType).toBe('role_permission');
    expect(auditArg.entityId).toBe('auditor:audit.read');
    expect(auditArg.action).toBe('grant');
    expect(auditArg.payload).toEqual({ role: 'auditor', permission_key: 'audit.read' });

    expect(r).toEqual({ role: 'auditor', permission_key: 'audit.read', granted: true });
  });

  it('no-op: existing grant → no INSERT, no audit, returns granted: false', async () => {
    const prisma = makePrismaForRP({
      permissionLookup: { id: 'p-1' },
      existingGrant: { role: 'admin', permission_id: 'p-1' },
    });
    const audit = makeAudit();
    const svc = new RolePermissionsService(prisma, audit);

    const r = await svc.grant('admin', 'audit.read', 'actor-1');

    const tx = (prisma as unknown as {
      _tx: { rolePermission: { create: ReturnType<typeof vi.fn> } };
    })._tx;
    expect(tx.rolePermission.create).not.toHaveBeenCalled();
    expect(audit.recordChange).not.toHaveBeenCalled();
    expect(r).toEqual({ role: 'admin', permission_key: 'audit.read', granted: false });
  });

  it('throws 404 when permission_key does not exist in catalog', async () => {
    const prisma = makePrismaForRP({ permissionLookup: null });
    const svc = new RolePermissionsService(prisma, makeAudit());
    await expect(
      svc.grant('admin', 'nonexistent.perm', 'actor-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('RolePermissionsService.revoke', () => {
  it('happy path: deleteMany count=1, audits, returns void', async () => {
    const prisma = makePrismaForRP({ permissionLookup: { id: 'p-1' }, deleteCount: 1 });
    const audit = makeAudit();
    const svc = new RolePermissionsService(prisma, audit);

    const r = await svc.revoke('auditor', 'audit.read', 'actor-1');

    const tx = (prisma as unknown as {
      _tx: { rolePermission: { deleteMany: ReturnType<typeof vi.fn> } };
    })._tx;
    expect(tx.rolePermission.deleteMany).toHaveBeenCalledOnce();
    const deleteArg = tx.rolePermission.deleteMany.mock.calls[0]![0] as {
      where: { role: string; permission_id: string };
    };
    expect(deleteArg.where).toEqual({ role: 'auditor', permission_id: 'p-1' });

    expect(audit.recordChange).toHaveBeenCalledOnce();
    const auditArg = (audit.recordChange as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      entityType: string;
      entityId: string;
      action: string;
    };
    expect(auditArg.entityType).toBe('role_permission');
    expect(auditArg.entityId).toBe('auditor:audit.read');
    expect(auditArg.action).toBe('revoke');

    expect(r).toBeUndefined();
  });

  it('no-op: deleteMany count=0 → no audit, returns void (no throw)', async () => {
    const prisma = makePrismaForRP({ permissionLookup: { id: 'p-1' }, deleteCount: 0 });
    const audit = makeAudit();
    const svc = new RolePermissionsService(prisma, audit);

    const r = await svc.revoke('auditor', 'audit.read', 'actor-1');

    expect(audit.recordChange).not.toHaveBeenCalled();
    expect(r).toBeUndefined();
  });

  it('catalog miss: permission_key does not exist → idempotent no-op (no throw, no audit)', async () => {
    const prisma = makePrismaForRP({ permissionLookup: null });
    const audit = makeAudit();
    const svc = new RolePermissionsService(prisma, audit);

    await expect(svc.revoke('admin', 'nonexistent.perm', 'actor-1')).resolves.toBeUndefined();
    expect(audit.recordChange).not.toHaveBeenCalled();
  });

  it('throws 409 with role+permission_key when revoking permission.manage from admin (lockout protection)', async () => {
    const prisma = makePrismaForRP();
    const svc = new RolePermissionsService(prisma, makeAudit());
    await expect(
      svc.revoke('admin', 'permission.manage', 'actor-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
