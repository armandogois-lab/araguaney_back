# Slice 5c — Role-permissions matrix management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the admin role-permissions endpoints: `GET /api/role-permissions` (matrix view), `PUT /api/role-permissions/:role/:permission_key` (idempotent grant), `DELETE /api/role-permissions/:role/:permission_key` (idempotent 204 revoke). All gated by `permission.manage`. Hard-blocks revoking `permission.manage` from `admin` to prevent system lockout. Extends the audit `entity_type` union with `'role_permission'`.

**Architecture:** New sub-feature `src/modules/admin/role-permissions/` (controller, service, DTO, mapper) registered in the existing `AdminModule` (Slices 5a/5b). Service uses `prisma.$transaction` to wrap mutation + audit (idempotent paths produce no audit row). The matrix endpoint runs `Promise.all([permissions.findMany, rolePermissions.findMany])` and assembles the `{ permissions, roles, matrix }` shape via a pure mapper. Two small files outside the new sub-feature pick up the new audit entity type: `src/modules/audit/types.ts` (TS union) and `src/modules/admin/audit/audit.dto.ts` (Zod enum).

**Tech Stack:** NestJS 10, TypeScript 5 strict, Prisma 5, Zod, Vitest, supertest. Reuses `AuditService.recordChange({ tx })` (Slice 3), the `prisma.$transaction` + atomic-audit pattern from Slices 4a-5a, and the parameter-level `ZodValidationPipe` convention. **No SQL migration. No new dependencies.**

---

## Spec reference

`docs/superpowers/specs/2026-05-07-slice-5c-role-permissions-design.md`. Read first for the 10 decisions table, error matrix, and smoke recipe.

## File structure

```
src/modules/admin/                              (existing, from Slices 5a/5b)
  role-permissions/                              NEW SUB-FEATURE
    role-permissions.controller.ts               CREATE: GET + PUT + DELETE
    role-permissions.controller.test.ts          CREATE: 9 supertest
    role-permissions.service.ts                  CREATE: getMatrix + grant + revoke
    role-permissions.service.test.ts             CREATE: 7 unit tests
    role-permissions.dto.ts                      CREATE: RoleParamSchema + PermissionKeyParamSchema
    responses/
      role-permissions-matrix.mapper.ts          CREATE: matrix shape builder
  admin.module.ts                                MODIFY: register controller + service

src/modules/audit/types.ts                       MODIFY: add 'role_permission' to AuditEntityType union
src/modules/admin/audit/audit.dto.ts             MODIFY: add 'role_permission' to AUDIT_ENTITY_TYPES Zod enum

openapi.json                                     REGENERATE + COMMIT
```

---

## Task 1: AuditEntityType extension + DTO + mapper

**Files:**
- Modify: `src/modules/audit/types.ts`
- Modify: `src/modules/admin/audit/audit.dto.ts`
- Create: `src/modules/admin/role-permissions/role-permissions.dto.ts`
- Create: `src/modules/admin/role-permissions/responses/role-permissions-matrix.mapper.ts`

This task widens the audit entity-type union to accept `'role_permission'` and scaffolds the new sub-feature's DTO + mapper. No tests in this task — they get exercised in Tasks 2-3.

- [ ] **Step 1: Extend `AuditEntityType` union**

Read `src/modules/audit/types.ts`. Currently:

```ts
export type AuditEntityType =
  | 'batch'
  | 'order'
  | 'installment'
  | 'certificate'
  | 'certificate_order'
  | 'investor'
  | 'merchant'
  | 'end_user'
  | 'user'
  | 'setting'
  | 'system';
```

Add `'role_permission'` between `'setting'` and `'system'`:

```ts
export type AuditEntityType =
  | 'batch'
  | 'order'
  | 'installment'
  | 'certificate'
  | 'certificate_order'
  | 'investor'
  | 'merchant'
  | 'end_user'
  | 'user'
  | 'setting'
  | 'role_permission'
  | 'system';
```

- [ ] **Step 2: Extend the audit query Zod enum**

Read `src/modules/admin/audit/audit.dto.ts`. Find the `AUDIT_ENTITY_TYPES` const tuple. Add `'role_permission'` between `'setting'` and `'system'`:

```ts
const AUDIT_ENTITY_TYPES = [
  'batch',
  'order',
  'installment',
  'certificate',
  'certificate_order',
  'investor',
  'merchant',
  'end_user',
  'user',
  'setting',
  'role_permission',
  'system',
] as const;
```

- [ ] **Step 3: Create the role-permissions DTO**

Create `src/modules/admin/role-permissions/role-permissions.dto.ts`:

```ts
import { z } from 'zod';

export const RoleParamSchema = z.enum(['operator', 'admin', 'auditor']);
export const PermissionKeyParamSchema = z
  .string()
  .min(3)
  .max(50)
  .regex(/^[a-z_]+\.[a-z_]+$/);

export type RoleParam = z.infer<typeof RoleParamSchema>;
export type PermissionKeyParam = z.infer<typeof PermissionKeyParamSchema>;
```

- [ ] **Step 4: Create the matrix mapper**

Create `src/modules/admin/role-permissions/responses/role-permissions-matrix.mapper.ts`:

```ts
export type PermissionRow = {
  id: string;
  key: string;
  description: string;
};

export type RolePermissionRow = {
  role: string;
  permission: { key: string };
};

export function toRolePermissionsMatrix(opts: {
  permissions: PermissionRow[];
  rolePermissions: RolePermissionRow[];
}) {
  const matrix: Record<string, string[]> = {
    operator: [],
    admin: [],
    auditor: [],
  };
  for (const rp of opts.rolePermissions) {
    if (matrix[rp.role]) matrix[rp.role].push(rp.permission.key);
  }
  return {
    permissions: opts.permissions.map((p) => ({
      key: p.key,
      description: p.description,
    })),
    roles: ['operator', 'admin', 'auditor'] as const,
    matrix,
  };
}
```

(`Permission.id` deliberately not in the output — the `key` is the natural identifier for the matrix UI.)

- [ ] **Step 5: Run all tests, expect them all still passing**

```bash
pnpm exec tsc --noEmit && pnpm test 2>&1 | tail -5
```

Expected: 260 tests still pass (no new tests yet). The `AuditEntityType` extension and the new DTO/mapper are forward-compatible — adding a value to a union never breaks existing consumers.

- [ ] **Step 6: Commit**

```bash
git add src/modules/audit/types.ts src/modules/admin/audit/audit.dto.ts src/modules/admin/role-permissions/
git commit -m "feat(role-permissions): scaffold DTO/mapper + extend AuditEntityType with role_permission"
```

---

## Task 2: RolePermissionsService (TDD)

**Files:**
- Create: `src/modules/admin/role-permissions/role-permissions.service.ts`
- Create: `src/modules/admin/role-permissions/role-permissions.service.test.ts`

Service implements `getMatrix` (parallel fetch of catalog + grants), `grant` (transactional with idempotent no-op detection and 404), and `revoke` (transactional with idempotent no-op + lockout protection).

- [ ] **Step 1: Write the failing tests**

Create `src/modules/admin/role-permissions/role-permissions.service.test.ts`:

```ts
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
    expect(r.matrix.auditor).toEqual([]); // empty but present
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
```

- [ ] **Step 2: Run, expect fail (service doesn't exist yet)**

```bash
pnpm vitest run src/modules/admin/role-permissions/role-permissions.service.test.ts
```

- [ ] **Step 3: Implement RolePermissionsService**

Create `src/modules/admin/role-permissions/role-permissions.service.ts`:

```ts
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
```

- [ ] **Step 4: Run service tests, expect 7 pass**

```bash
pnpm vitest run src/modules/admin/role-permissions/role-permissions.service.test.ts
```

Expected: 7 passed (1 getMatrix + 3 grant + 4 revoke including catalog-miss case).

- [ ] **Step 5: TS check + commit**

```bash
pnpm exec tsc --noEmit
git add src/modules/admin/role-permissions/role-permissions.service.ts src/modules/admin/role-permissions/role-permissions.service.test.ts
git commit -m "feat(role-permissions): RolePermissionsService with idempotent grant/revoke + lockout protection (TDD)"
```

---

## Task 3: RolePermissionsController + AdminModule wire (TDD)

**Files:**
- Create: `src/modules/admin/role-permissions/role-permissions.controller.ts`
- Create: `src/modules/admin/role-permissions/role-permissions.controller.test.ts`
- Modify: `src/modules/admin/admin.module.ts`

- [ ] **Step 1: Write the failing controller tests**

Create `src/modules/admin/role-permissions/role-permissions.controller.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConflictException, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { RolePermissionsController } from './role-permissions.controller';
import { RolePermissionsService } from './role-permissions.service';
import { JwtService } from '../../auth/jwt.service';
import { UserLookupService } from '../../auth/user-lookup.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { mintTestJwt, TEST_SECRET } from '../../../../test/helpers/jwt.helper';
import { mockAuthUser } from '../../../../test/helpers/auth-user.helper';

describe('RolePermissionsController', () => {
  let app: INestApplication;
  let svc: {
    getMatrix: ReturnType<typeof vi.fn>;
    grant: ReturnType<typeof vi.fn>;
    revoke: ReturnType<typeof vi.fn>;
  };
  let prismaPerms: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    svc = { getMatrix: vi.fn(), grant: vi.fn(), revoke: vi.fn() };
    prismaPerms = vi.fn().mockResolvedValue([]);
    const config = {
      get: (k: string) => (k === 'SUPABASE_JWT_SECRET' ? TEST_SECRET : undefined),
    } as unknown as ConfigService;

    const moduleRef = await Test.createTestingModule({
      controllers: [RolePermissionsController],
      providers: [
        { provide: RolePermissionsService, useValue: svc },
        { provide: ConfigService, useValue: config },
        JwtService,
        {
          provide: UserLookupService,
          useValue: {
            findByAuthId: vi
              .fn()
              .mockResolvedValue({ kind: 'found', user: mockAuthUser({ role: 'operator' }) }),
          },
        },
        { provide: PrismaService, useValue: { rolePermission: { findMany: prismaPerms } } },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /api/role-permissions → 401 without token', async () => {
    await request(app.getHttpServer()).get('/api/role-permissions').expect(401);
  });

  it('GET /api/role-permissions → 403 when role lacks permission.manage', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'audit.read' } }]);
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .get('/api/role-permissions')
      .set('Authorization', `Bearer ${t}`)
      .expect(403);
  });

  it('GET /api/role-permissions → 200 happy', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'permission.manage' } }]);
    svc.getMatrix.mockResolvedValueOnce({
      permissions: [{ key: 'audit.read', description: 'Ver audit' }],
      roles: ['operator', 'admin', 'auditor'],
      matrix: { operator: ['audit.read'], admin: ['audit.read'], auditor: ['audit.read'] },
    });
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    const res = await request(app.getHttpServer())
      .get('/api/role-permissions')
      .set('Authorization', `Bearer ${t}`)
      .expect(200);
    expect(res.body.permissions).toHaveLength(1);
    expect(res.body.matrix.admin).toContain('audit.read');
  });

  it('PUT /:role/:permission_key → 401 without token', async () => {
    await request(app.getHttpServer())
      .put('/api/role-permissions/auditor/audit.read')
      .expect(401);
  });

  it('PUT /:role/:permission_key → 403 when role lacks permission.manage', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'audit.read' } }]);
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .put('/api/role-permissions/auditor/audit.read')
      .set('Authorization', `Bearer ${t}`)
      .expect(403);
  });

  it('PUT /:role/:permission_key → 200 happy', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'permission.manage' } }]);
    svc.grant.mockResolvedValueOnce({
      role: 'auditor',
      permission_key: 'audit.read',
      granted: true,
    });
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    const res = await request(app.getHttpServer())
      .put('/api/role-permissions/auditor/audit.read')
      .set('Authorization', `Bearer ${t}`)
      .expect(200);
    expect(res.body).toEqual({
      role: 'auditor',
      permission_key: 'audit.read',
      granted: true,
    });
  });

  it('PUT /invalid_role/audit.read → 400 (Zod role enum)', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'permission.manage' } }]);
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .put('/api/role-permissions/superuser/audit.read')
      .set('Authorization', `Bearer ${t}`)
      .expect(400);
  });

  it('DELETE /:role/:permission_key → 204 happy', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'permission.manage' } }]);
    svc.revoke.mockResolvedValueOnce(undefined);
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .delete('/api/role-permissions/auditor/audit.read')
      .set('Authorization', `Bearer ${t}`)
      .expect(204);
  });

  it('DELETE /admin/permission.manage → 409 (lockout protection)', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'permission.manage' } }]);
    svc.revoke.mockRejectedValueOnce(
      new ConflictException({
        message: 'No se puede revocar permission.manage del rol admin',
        role: 'admin',
        permission_key: 'permission.manage',
      }),
    );
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    const res = await request(app.getHttpServer())
      .delete('/api/role-permissions/admin/permission.manage')
      .set('Authorization', `Bearer ${t}`)
      .expect(409);
    expect(res.body.role).toBe('admin');
    expect(res.body.permission_key).toBe('permission.manage');
  });
});
```

- [ ] **Step 2: Run, expect fail (controller doesn't exist yet)**

```bash
pnpm vitest run src/modules/admin/role-permissions/role-permissions.controller.test.ts
```

- [ ] **Step 3: Implement the controller**

Create `src/modules/admin/role-permissions/role-permissions.controller.ts`:

```ts
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import type { AuthUser } from '../../auth/types';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { RolePermissionsService } from './role-permissions.service';
import {
  RoleParamSchema,
  PermissionKeyParamSchema,
  type RoleParam,
} from './role-permissions.dto';

@ApiTags('role-permissions')
@ApiBearerAuth()
@Controller('role-permissions')
export class RolePermissionsController {
  constructor(private readonly rolePermissions: RolePermissionsService) {}

  @Get()
  @RequirePermission('permission.manage')
  getMatrix() {
    return this.rolePermissions.getMatrix();
  }

  @Put(':role/:permission_key')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('permission.manage')
  grant(
    @Param('role', new ZodValidationPipe(RoleParamSchema)) role: RoleParam,
    @Param('permission_key', new ZodValidationPipe(PermissionKeyParamSchema)) permissionKey: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.rolePermissions.grant(role, permissionKey, user.id);
  }

  @Delete(':role/:permission_key')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('permission.manage')
  revoke(
    @Param('role', new ZodValidationPipe(RoleParamSchema)) role: RoleParam,
    @Param('permission_key', new ZodValidationPipe(PermissionKeyParamSchema)) permissionKey: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.rolePermissions.revoke(role, permissionKey, user.id);
  }
}
```

- [ ] **Step 4: Wire into AdminModule**

Read `src/modules/admin/admin.module.ts`. Currently registers Settings + Audit. Replace its contents:

```ts
import { Module } from '@nestjs/common';
import { SettingsController } from './settings/settings.controller';
import { SettingsService } from './settings/settings.service';
import { AuditController } from './audit/audit.controller';
import { AuditQueryService } from './audit/audit.service';
import { RolePermissionsController } from './role-permissions/role-permissions.controller';
import { RolePermissionsService } from './role-permissions/role-permissions.service';

@Module({
  controllers: [SettingsController, AuditController, RolePermissionsController],
  providers: [SettingsService, AuditQueryService, RolePermissionsService],
})
export class AdminModule {}
```

- [ ] **Step 5: Run controller tests, expect 9 pass**

```bash
pnpm vitest run src/modules/admin/role-permissions/role-permissions.controller.test.ts
```

Expected: 9 passed.

- [ ] **Step 6: TS check + commit**

```bash
pnpm exec tsc --noEmit
git add src/modules/admin/role-permissions/role-permissions.controller.ts src/modules/admin/role-permissions/role-permissions.controller.test.ts src/modules/admin/admin.module.ts
git commit -m "feat(role-permissions): controller + AdminModule wiring (TDD)"
```

---

## Task 4: Smoke + openapi

**Files:**
- Generate + force-add: `openapi.json`

- [ ] **Step 1: Run full test suite + TS + lint**

```bash
pnpm exec tsc --noEmit && pnpm test 2>&1 | tail -10 && pnpm lint 2>&1 | tail -5
```

Expected: zero TS errors, ~276 tests passing total (260 from prior slices + 16 new from 5c: 7 service + 9 controller). Lint clean.

If lint reports errors that originated from prior tasks, fix them and commit before proceeding.

- [ ] **Step 2: Promote test user to admin (smoke needs PUT/DELETE)**

Use the Supabase MCP `mcp__plugin_supabase_supabase__execute_sql` (project ref `esobivqsddwrbxlytfsn`):

```sql
UPDATE cfb.users SET role='admin' WHERE auth_user_id='4bba7f81-443c-47b2-9bec-bc5a502380cc' RETURNING id, role;
```

- [ ] **Step 3: Boot dev server**

```bash
lsof -ti:3001 | xargs -r kill -9 2>/dev/null; sleep 1
pnpm dev > /tmp/araguaney-dev.log 2>&1 &
DEV_PID=$!
sleep 7
tail -20 /tmp/araguaney-dev.log
```

- [ ] **Step 4: Run smoke**

```bash
cat > scripts/smoke-slice5c.ts <<'TSEOF'
import 'dotenv/config';
import { SignJWT } from 'jose';
import { request as httpRequest } from 'node:http';
import { URL } from 'node:url';
import { Buffer } from 'node:buffer';

const BASE = 'http://localhost:3001';
const SUB = '4bba7f81-443c-47b2-9bec-bc5a502380cc';

async function token(): Promise<string> {
  const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET!);
  return await new SignJWT({ sub: SUB })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
    .sign(secret);
}

function call(method: string, path: string, t: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path);
    const req = httpRequest({
      method, hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      headers: { Authorization: `Bearer ${t}` },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c as Buffer));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const t = await token();

  // 1. GET matrix.
  const m1 = await call('GET', '/api/role-permissions', t);
  console.log(`${m1.status} GET /api/role-permissions\n${m1.body.slice(0, 600)}\n---`);

  // 2. PUT auditor/permission.manage (grant).
  const grant = await call('PUT', '/api/role-permissions/auditor/permission.manage', t);
  console.log(`${grant.status} PUT /auditor/permission.manage (grant)\n${grant.body.slice(0, 240)}\n---`);

  // 3. GET matrix again — should include the new grant.
  const m2 = await call('GET', '/api/role-permissions', t);
  console.log(`${m2.status} GET /api/role-permissions (after grant)\n${m2.body.slice(0, 600)}\n---`);

  // 4. PUT same again (no-op).
  const grantNoop = await call('PUT', '/api/role-permissions/auditor/permission.manage', t);
  console.log(`${grantNoop.status} PUT /auditor/permission.manage (re-grant, expect granted:false)\n${grantNoop.body.slice(0, 240)}\n---`);

  // 5. DELETE the grant.
  const revoke = await call('DELETE', '/api/role-permissions/auditor/permission.manage', t);
  console.log(`${revoke.status} DELETE /auditor/permission.manage (revoke)\n${revoke.body || '(no body)'}\n---`);

  // 6. DELETE same again (no-op idempotent).
  const revokeNoop = await call('DELETE', '/api/role-permissions/auditor/permission.manage', t);
  console.log(`${revokeNoop.status} DELETE /auditor/permission.manage (re-delete, expect 204)\n${revokeNoop.body || '(no body)'}\n---`);

  // 7. DELETE admin/permission.manage → lockout 409.
  const lockout = await call('DELETE', '/api/role-permissions/admin/permission.manage', t);
  console.log(`${lockout.status} DELETE /admin/permission.manage (should 409)\n${lockout.body.slice(0, 240)}\n---`);

  // 8. PUT operator/nonexistent.perm → 404.
  const nf = await call('PUT', '/api/role-permissions/operator/nonexistent.perm', t);
  console.log(`${nf.status} PUT /operator/nonexistent.perm (should 404)\n${nf.body.slice(0, 240)}\n---`);

  // 9. PUT superuser/audit.read → 400 (Zod role enum).
  const badRole = await call('PUT', '/api/role-permissions/superuser/audit.read', t);
  console.log(`${badRole.status} PUT /superuser/audit.read (should 400)\n${badRole.body.slice(0, 240)}\n---`);
}
main().catch((e) => { console.error(e); process.exit(1); });
TSEOF
pnpm exec tsx scripts/smoke-slice5c.ts 2>&1 | head -250
rm -f scripts/smoke-slice5c.ts
```

Expected:
- Call 1 (GET): **200** with `permissions.length === 22`, `matrix.admin` includes `'permission.manage'`, `matrix.operator` doesn't include it.
- Call 2 (PUT grant): **200** with `{ role: 'auditor', permission_key: 'permission.manage', granted: true }`.
- Call 3 (GET): **200** with `matrix.auditor` now containing `'permission.manage'`.
- Call 4 (PUT no-op): **200** with `{ role: 'auditor', permission_key: 'permission.manage', granted: false }`.
- Call 5 (DELETE): **204** with empty body.
- Call 6 (DELETE again): **204** (idempotent).
- Call 7 (DELETE admin/permission.manage): **409** with body `{ role: 'admin', permission_key: 'permission.manage', message: 'No se puede revocar permission.manage del rol admin' }`.
- Call 8 (PUT nonexistent perm): **404**.
- Call 9 (PUT bad role): **400** with Zod enum error.

If any call fails, check `/tmp/araguaney-dev.log`.

- [ ] **Step 5: Verify audit_log entries**

Via Supabase MCP `execute_sql`:

```sql
SELECT entity_type, entity_id, action, payload->'role' AS role, payload->'permission_key' AS perm_key, occurred_at
FROM cfb.audit_log
WHERE entity_type = 'role_permission'
ORDER BY occurred_at DESC LIMIT 5;
-- Expected: 2 rows from this smoke (1 'grant' + 1 'revoke', both for auditor:permission.manage).
-- The no-op PUT (call 4) and idempotent DELETE (call 6) produced NO rows.
```

- [ ] **Step 6: Demote test user back to operator**

```sql
UPDATE cfb.users SET role='operator' WHERE auth_user_id='4bba7f81-443c-47b2-9bec-bc5a502380cc' RETURNING id, role;
```

- [ ] **Step 7: Stop server**

```bash
kill $DEV_PID 2>/dev/null; wait $DEV_PID 2>/dev/null
lsof -ti:3001 | xargs -r kill -9 2>/dev/null
```

- [ ] **Step 8: Regenerate openapi.json**

```bash
pnpm openapi:export
node -e "const d = require('./openapi.json'); const ks = Object.keys(d.paths).sort(); console.log(ks); console.log('count:', ks.length); console.log('rp methods:', Object.keys(d.paths['/api/role-permissions'] ?? {})); console.log('rp/{role} methods:', Object.keys(d.paths['/api/role-permissions/{role}/{permission_key}'] ?? {}));"
```

Expected: 25 paths total (was 23). Two new paths: `/api/role-permissions` (`get`) and `/api/role-permissions/{role}/{permission_key}` (`put`, `delete`).

- [ ] **Step 9: Force-add and commit openapi**

```bash
git add -f openapi.json
git commit -m "feat(openapi): regenerate with /api/role-permissions GET + PUT + DELETE"
```

---

## Self-review

**1. Spec coverage:**

| Spec section | Implemented in task |
|---|---|
| §3 Architecture (admin/role-permissions/, AdminModule extension) | Tasks 1, 3 |
| §4.1 GET /api/role-permissions (matrix shape) | Tasks 2 (service), 3 (controller) |
| §4.2 PUT /:role/:permission_key (grant, idempotency) | Tasks 2 (service), 3 (controller) |
| §4.3 DELETE /:role/:permission_key (revoke, idempotent 204) | Tasks 2 (service), 3 (controller) |
| §4.4 Error matrix (400/401/403/404/409) | Tasks 2 (404/409), 3 (401/403/400) |
| §5 Service (transactional grant/revoke + audit) | Task 2 |
| §6.1 DTO (RoleParamSchema, PermissionKeyParamSchema) | Task 1 |
| §6.2 Mapper (matrix shape) | Task 1 |
| §7 Controller (parameter-level pipes, RequirePermission permission.manage) | Task 3 |
| §8 AuditEntityType extension (`role_permission`) | Task 1 (both files) |
| §9 AdminModule wiring (third controller + service) | Task 3 |
| §10.1 Service tests (~7) | Task 2 |
| §10.2 Controller tests (~9) | Task 3 |
| §10.3 Smoke real | Task 4 |
| §11 Observability (audit on real changes only) | Task 2 (no-op short-circuits) |
| §12 Acceptance criteria | Task 4 |

**2. Placeholder scan:**

No "TBD", "TODO", "implement later" patterns. Every step shows actual code or actual commands.

**3. Type/name consistency:**

- `RoleParamSchema`, `PermissionKeyParamSchema`, `RoleParam`, `PermissionKeyParam` defined in Task 1, used in Tasks 2 (service signature) and 3 (controller). ✓
- `PermissionRow`, `RolePermissionRow`, `toRolePermissionsMatrix` defined in Task 1, used in Task 2. ✓
- `RolePermissionsService.getMatrix()`, `.grant(role, permissionKey, actorId)`, `.revoke(role, permissionKey, actorId)` — signatures consistent between Tasks 2 (service) and 3 (controller). ✓
- Audit `entityType: 'role_permission'`, `entityId: '${role}:${permissionKey}'` — consistent across grant/revoke service paths and the test assertions. ✓
- Prisma compound key `role_permission_id` (composite UNIQUE name from `@@unique([role, permission_id], map: "role_permissions_role_permission_id_key")`) — Prisma client exposes this as `where: { role_permission_id: { role, permission_id } }`. ✓
- `AuditEntityType` extension in `src/modules/audit/types.ts` — Task 1 step 1. The Zod enum extension in `src/modules/admin/audit/audit.dto.ts` — Task 1 step 2. Both must be added; the audit query API (Slice 5b) starts accepting `entity_type=role_permission` after this. ✓
- `permission.manage` permission key (already seeded for admin in `006_seeds.sql`) — used in `@RequirePermission('permission.manage')` in Task 3. ✓
- AdminModule wiring extends from Slice 5b's state (Settings + Audit) to add a third controller + service. ✓

No issues found.

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-05-07-slice-5c-role-permissions.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review.
2. **Inline Execution** — execute tasks in this session with checkpoints.

Which approach?
