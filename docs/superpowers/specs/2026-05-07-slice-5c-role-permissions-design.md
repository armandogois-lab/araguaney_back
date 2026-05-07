# Slice 5c — Role-permissions matrix management

**Estado:** approved · 2026-05-07
**Repo:** `araguaney_back`
**Depende de:** Slice 0 (DB schema con `cfb.permissions` + `cfb.role_permissions` + 22 permisos seedeados + `permission.manage` granted to admin), Slice 1 (auth/permissions), Slice 5a (AdminModule existente), Slice 5b (`AuditEntityType` union, audit query API).

---

## 1. Alcance

Slice 5c expone el grid de role-permissions vía 3 endpoints administrativos:
- `GET /api/role-permissions` — full matrix view (catalog + grid).
- `PUT /api/role-permissions/:role/:permission_key` — idempotent grant.
- `DELETE /api/role-permissions/:role/:permission_key` — idempotent revoke.

Todos gated por `permission.manage` (admin only — ya seedeado).

Hard-block sobre `(admin, permission.manage)` revoke para prevenir lockout del sistema. Audit en formato `{ role, permission_key }` con nuevo `entity_type='role_permission'` (extiende el union de Slice 5b).

Es la **última de las 3 sub-slices de Slice 5** (admin features). Después de esto, el sistema admin tiene CRUD completo sobre los 3 ejes administrativos: settings (5a), audit query (5b), role-permissions (5c).

**Excluye:** edición del catalog `cfb.permissions` (los 22 permission keys son data + DDL — agregarlos requiere code change para que los services los chequen, fuera de scope), creation de nuevos roles (el `UserRole` enum es DDL), bulk grant/revoke (matrix UI llama PUT/DELETE celda por celda), notifications.

---

## 2. Decisiones tomadas (no re-discutir)

| # | Decisión | Justificación |
|---|---|---|
| 1 | Matrix endpoint shape `(c)`: `{ permissions, roles, matrix }` | Optimizado para el grid UI: 1 fetch entrega catalog completo + bitmap. Frontend no necesita 2 endpoints |
| 2 | DELETE idempotent (204 no-op cuando already revoked) | Reconcilia stale frontend state sin error confuso; HTTP DELETE convention |
| 3 | Hard-block (`admin`, `permission.manage`) revoke con 409 | Previene lockout completo del sistema (recovery requeriría SQL admin); lossless flexibility |
| 4 | `entity_type='role_permission'` (nuevo union member) | Future audit queries pueden filtrar exactly permission-matrix history; consistente con Slice 5b filter UX |
| 5 | PUT idempotent: existing grant → no INSERT, no audit, returns `{ granted: false }` | Mismo patrón que no-op detection en Slices 4d/5a |
| 6 | URL params validados via Zod (`@Param(new ZodValidationPipe(...))`) | Catch typos at URL boundary; el regex en `permission_key` rechaza cualquier cosa que no sea `<word>.<word>` |
| 7 | Composite `entityId='${role}:${permissionKey}'` en audit log | Future query: `entity_type=role_permission&entity_id=admin:audit.read` returns full grant/revoke history of that cell |
| 8 | `revoke` usa `deleteMany` (no `delete`) | `deleteMany` no throws cuando 0 rows match — natural idempotency sin try/catch P2025 |
| 9 | `grant` hace `findUnique` outside tx, INSERT inside | Outside: 404 cleanly + load permission_id. Inside: handle race entre dos admins concurrentes (second sees existing → no-op) |
| 10 | Reuse `AdminModule` (Slice 5a/5b) — no nuevo module | Tercer controller en la admin home; AdminModule grows controllers from 2 to 3 |

---

## 3. Arquitectura

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

**No SQL migration.** All schema in place from Slice 0 (`RolePermission` table with composite UNIQUE, `Permission` catalog with 22 seeded rows, `permission.manage` granted to admin).

**`AdminModule` after Slice 5c**: 3 controllers (`SettingsController`, `AuditController`, `RolePermissionsController`), 3 providers (`SettingsService`, `AuditQueryService`, `RolePermissionsService`).

**Reuses prior infrastructure:**
- `AuditService.recordChange({ tx })` (Slice 3) for grant/revoke audit rows.
- `prisma.$transaction` for atomicity of mutation + audit.
- `JwtAuthGuard` (Slice 1) + `PermissionsGuard` for auth.

---

## 4. Endpoints

### 4.1 `GET /api/role-permissions`

- **Permission:** `permission.manage` (admin only).
- **HTTP:** 200.
- **Response:**

```ts
{
  permissions: [
    { key: 'audit.read', description: 'Ver el audit_log completo' },
    { key: 'batch.read', description: '...' },
    // ... all 22 catalog rows, sorted by key asc
  ],
  roles: ['operator', 'admin', 'auditor'],
  matrix: {
    operator: ['audit.read', 'batch.read', 'batch.upload', /* ...13 keys */],
    admin: ['audit.read', /* ...20 keys */],
    auditor: ['audit.read', /* ...7 keys */],
  },
}
```

(`Permission.id` deliberately not exposed — `key` is the natural identifier.)

### 4.2 `PUT /api/role-permissions/:role/:permission_key`

- **Permission:** `permission.manage`.
- **HTTP:** 200.
- **Body:** none. URL carries all info.
- **Response:**

```ts
{ role, permission_key, granted: boolean }  // granted=true on actual grant; false on no-op
```

### 4.3 `DELETE /api/role-permissions/:role/:permission_key`

- **Permission:** `permission.manage`.
- **HTTP:** 204 (no body).
- **Body:** none.
- Idempotent: DELETE on a row that doesn't exist returns 204 with no audit row.

### 4.4 Matriz de errores

| Code | Cuándo |
|---|---|
| 400 | Zod: `:role` not in `operator/admin/auditor`, `:permission_key` doesn't match regex `^[a-z_]+\.[a-z_]+$` or out of length 3..50 |
| 401 | sin JWT |
| 403 | rol sin `permission.manage` (operator/auditor) |
| 404 | PUT: `permission_key` not in catalog. DELETE never 404s (idempotent) |
| 409 | DELETE on (`admin`, `permission.manage`) — system lockout protection. Body: `{ message: 'No se puede revocar permission.manage del rol admin', role: 'admin', permission_key: 'permission.manage' }` |

Mensajes de negocio en **español**.

---

## 5. Service `getMatrix` + `grant` + `revoke`

```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

**Audit log entries:**

| Action | Payload | entityId |
|---|---|---|
| grant | `{ role: 'auditor', permission_key: 'audit.read' }` | `'auditor:audit.read'` |
| revoke | `{ role: 'auditor', permission_key: 'audit.read' }` | `'auditor:audit.read'` |

The composite `entityId` lets future queries pull the full grant/revoke history of an exact cell: `entity_type=role_permission&entity_id=admin:audit.read`.

---

## 6. DTO + Mapper

### 6.1 `role-permissions.dto.ts`

```ts
import { z } from 'zod';

export const RoleParamSchema = z.enum(['operator', 'admin', 'auditor']);
export const PermissionKeyParamSchema = z.string().min(3).max(50).regex(/^[a-z_]+\.[a-z_]+$/);

export type RoleParam = z.infer<typeof RoleParamSchema>;
export type PermissionKeyParam = z.infer<typeof PermissionKeyParamSchema>;
```

### 6.2 `responses/role-permissions-matrix.mapper.ts`

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

(`Permission.id` not exposed; `key` is the natural identifier.)

---

## 7. Controller

```ts
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import type { AuthUser } from '../../auth/types';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { RolePermissionsService } from './role-permissions.service';
import { RoleParamSchema, PermissionKeyParamSchema, type RoleParam } from './role-permissions.dto';

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

`ZodValidationPipe` works on `@Param()` the same way it works on `@Body()`/`@Query()` — parses the param string through the schema.

---

## 8. AuditEntityType extension

### 8.1 `src/modules/audit/types.ts` — add `'role_permission'`

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
  | 'role_permission'   // NEW
  | 'system';
```

### 8.2 `src/modules/admin/audit/audit.dto.ts` — extend the Zod enum

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
  'role_permission',   // NEW
  'system',
] as const;
```

After this change, `GET /api/audit?entity_type=role_permission` is a valid filter.

---

## 9. Module wiring

`src/modules/admin/admin.module.ts` extends to:

```ts
@Module({
  controllers: [SettingsController, AuditController, RolePermissionsController],
  providers: [SettingsService, AuditQueryService, RolePermissionsService],
})
export class AdminModule {}
```

`AppModule` already imports `AdminModule` (Slice 5a) — no change.

---

## 10. Tests

### 10.1 `role-permissions.service.test.ts` (~7)

| # | Scenario |
|---|---|
| 1 | `getMatrix` returns `{ permissions, roles, matrix }` shape; matrix has all 3 role keys even when empty |
| 2 | `grant` happy: creates rolePermission, audits with entity_type='role_permission' + entityId='role:perm', returns `{ granted: true }` |
| 3 | `grant` no-op: existing grant → no INSERT, no audit, returns `{ granted: false }` |
| 4 | `grant` 404 when permission_key doesn't exist in catalog |
| 5 | `revoke` happy: deleteMany count=1, audits, returns void |
| 6 | `revoke` no-op: deleteMany count=0 → no audit, returns void (no throw) |
| 7 | `revoke` 409 with `{ role: 'admin', permission_key: 'permission.manage' }` (lockout protection) |

### 10.2 `role-permissions.controller.test.ts` (~9)

| # | Scenario |
|---|---|
| 1 | `GET /api/role-permissions` → 401 without token |
| 2 | `GET /api/role-permissions` → 403 when role lacks `permission.manage` (operator) |
| 3 | `GET /api/role-permissions` → 200 happy (admin) |
| 4 | `PUT /:role/:permission_key` → 401 without token |
| 5 | `PUT /:role/:permission_key` → 403 (operator) |
| 6 | `PUT /:role/:permission_key` → 200 happy (admin) |
| 7 | `PUT /invalid_role/audit.read` → 400 (Zod role enum) |
| 8 | `DELETE /:role/:permission_key` → 204 happy (admin) |
| 9 | `DELETE /admin/permission.manage` → 409 (lockout — service throws ConflictException, controller propagates body) |

**Total nuevo:** ~16 tests. Total post-5c: 260 + 16 ≈ 276.

### 10.3 Smoke real

The `role_permissions` table has 40 seeded rows. Test user is `operator`; we promote to admin temporarily.

1. Promote test user to admin via Supabase MCP:
   ```sql
   UPDATE cfb.users SET role='admin' WHERE auth_user_id='4bba7f81-443c-47b2-9bec-bc5a502380cc';
   ```
2. Boot dev server, mint JWT.
3. **GET /api/role-permissions** → 200 with `permissions.length === 22`, `matrix.admin` includes `'permission.manage'`, `matrix.operator` doesn't.
4. **PUT /api/role-permissions/auditor/permission.manage** → 200 with `{ granted: true }`.
5. **GET /api/role-permissions** again → confirms `matrix.auditor` now includes `'permission.manage'`.
6. **PUT /api/role-permissions/auditor/permission.manage** (re-grant) → 200 with `{ granted: false }` (no-op).
7. **DELETE /api/role-permissions/auditor/permission.manage** → 204.
8. **DELETE /api/role-permissions/auditor/permission.manage** (re-delete) → 204 (idempotent).
9. **DELETE /api/role-permissions/admin/permission.manage** → 409 with body `{ role: 'admin', permission_key: 'permission.manage', message: 'No se puede revocar permission.manage del rol admin' }`.
10. **PUT /api/role-permissions/operator/nonexistent.perm** → 404.
11. **PUT /api/role-permissions/superuser/audit.read** → 400 (Zod role enum).
12. Demote: `UPDATE cfb.users SET role='operator' WHERE ...`.
13. Verify `audit_log`:
    ```sql
    SELECT entity_type, entity_id, action, payload->'role' AS role, payload->'permission_key' AS perm_key
    FROM cfb.audit_log
    WHERE entity_type='role_permission'
    ORDER BY occurred_at DESC LIMIT 5;
    -- Expected: 2 rows — one 'grant' (auditor:permission.manage), one 'revoke' (auditor:permission.manage).
    -- The no-op PUT (step 6) and idempotent DELETE (step 8) produced NO rows.
    ```
14. Stop server.

---

## 11. Observabilidad

- **Audit log:** una fila por cada grant/revoke real (no-op no escribe). `entity_type='role_permission'`, `entity_id='${role}:${permissionKey}'`, payload `{ role, permission_key }`.
- **Pino structured logs:** **deferred** (consistente con todos los slices previos).

---

## 12. Acceptance criteria

- [ ] `GET /api/role-permissions`, `PUT /api/role-permissions/:role/:permission_key`, `DELETE /api/role-permissions/:role/:permission_key` expuestos.
- [ ] `'role_permission'` agregado a `AuditEntityType` union y a `AUDIT_ENTITY_TYPES` Zod enum.
- [ ] `pnpm test` ≈ 276 verde.
- [ ] `pnpm exec tsc --noEmit` clean.
- [ ] `pnpm lint` clean.
- [ ] Smoke real ejecutado: GET/PUT/DELETE/idempotency/lockout/404/400 todos verificados.
- [ ] `openapi.json` regenerado y commited.
- [ ] AdminModule registra los 3 controllers.
- [ ] Sin nuevas dependencias. Sin migración SQL.

---

## 13. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Admin Bob revoca `permission.manage` from admin → lockout total | Hard-block en service (Q3): 409 con mensaje claro. Recovery via SQL admin no aplica |
| Race entre dos admins concurrent grants of same cell | Composite UNIQUE `(role, permission_id)` rechaza segundo INSERT con P2002. Por seguridad, el `findUnique` dentro del tx atrapa el caso normal y returns no-op |
| Race entre grant + revoke del mismo cell | Last-write-wins. Audit log preserves both events with timestamps. No corruption |
| Drift entre Zod `RoleParamSchema` y Prisma `UserRole` enum | Hardcoded literal con comment cross-referencing; mismo riesgo aceptado en 5b's AUDIT_ENTITY_TYPES |
| `permission_key` válido por regex pero no existe en catalog | `grant` returns 404 explícito; `revoke` retorna 204 idempotent (catalog miss = nothing to revoke) |
| Frontend matrix UI tiene state stale | Después de cualquier mutation, refresca via GET. Idempotent DELETE absorbe el caso "user clicked revoke twice" |

---

## 14. Out of scope (para slices siguientes)

- **Edición del catalog `cfb.permissions`:** los 22 permission keys son data-+-DDL (services chequean strings hardcoded como `'audit.read'`); agregar nuevas keys requiere code change. Slice futuro si product lo pide.
- **Creation de nuevos roles:** el `UserRole` enum es DDL. Same deal — code change required.
- **Bulk grant/revoke endpoint:** YAGNI; matrix UI llama PUT/DELETE celda por celda.
- **Notifications:** email al admin cuando otro admin revoca un permiso suyo. Slice 6+ (notifications infrastructure).
- **Pino structured logs:** deferred consistentemente.
