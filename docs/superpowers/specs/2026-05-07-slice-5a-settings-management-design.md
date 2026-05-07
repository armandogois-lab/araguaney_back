# Slice 5a — Settings management (`cfb.settings` PATCH)

**Estado:** approved · 2026-05-07
**Repo:** `araguaney_back`
**Depende de:** Slice 0 (DB schema con `cfb.settings` singleton + permiso `settings.manage` seedeado para admin), Slice 1 (auth/permissions), Slice 4d (patrón de PATCH con diff audit + Prisma transaction).

---

## 1. Alcance

Slice 5a expone el row singleton de `cfb.settings` vía dos endpoints:
- `GET /api/settings` — abierto a cualquier usuario autenticado (no requiere permiso explícito).
- `PATCH /api/settings` — gated por `settings.manage` (admin only).

Los 3 campos editables son `default_sweep_rate`, `shortfall_warning_threshold`, `concentration_warning_threshold`. Audit en formato diff. No hay migración SQL — todas las columnas (incluyendo `updated_at`/`updated_by_id`) ya existen desde Slice 0.

Es la primera de las 3 sub-slices de Slice 5 (admin features). Las siguientes (en orden recomendado) son **5b — Audit log query API** y **5c — Role-permissions matrix management**.

**Excluye (deferred a 5b/5c o slices posteriores):** `audit_log` query API (5b), `role_permissions` matrix endpoints (5c), email notifications (Slice 6+), Pino structured logs (cross-cutting refactor), batch archive endpoint, frontend-only views.

---

## 2. Decisiones tomadas (no re-discutir)

| # | Decisión | Justificación |
|---|---|---|
| 1 | `GET` open to any authenticated user (no `@RequirePermission`); `PATCH` gated by `settings.manage` | Settings driven UX — operadores ven el rate por default sin admin hand-off. Valores no son secretos |
| 2 | Zod ranges business-tight: rate `[0, 0.999999]`, thresholds `[0, 1]` | Coincide con el rango de `Certificate.annual_rate` (rate < 1, discount factor); thresholds son fracciones |
| 3 | Endpoints unparameterized (`GET /api/settings`, `PATCH /api/settings`) — singleton implícito | El `Setting.id` siempre es 1 (DB CHECK constraint). Sin `:id` en la URL |
| 4 | Body PATCH `.strict().refine(>0 keys)` | Rechaza claves desconocidas (e.g., `id`) y body vacío. Mismo patrón que Slice 4d |
| 5 | Audit en formato diff `{ changed: { field: { from, to } } }`, valores stringificados con `.toFixed(6)` | JSON pierde precisión decimal; stringificar preserva representación exacta. Matches mapper's serialization |
| 6 | Comparación de valores via `prev.equals(next)` (Decimal API), no `!==` | Decimals son objetos; strict equality los trataría siempre como diferentes |
| 7 | No-op detection: si el cliente manda valores idénticos al actual, no se escribe ni se audita | Mismo patrón que Slice 4d |
| 8 | Wrap UPDATE + audit en `prisma.$transaction(async (tx) => ...)` | Atomicidad del audit con la mutation; mismo patrón que Slices 4a-4d |
| 9 | Audit `entity_type='settings'`, `entity_id='1'` (string-coerced del int singleton) | Future audit queries podrán filtrar por `entity_type='settings'`. Mismo schema que existing audit rows |
| 10 | Nuevo módulo `src/modules/admin/` con sub-feature `settings/` | Slices 5b y 5c viven aquí también; establecer la home compartida desde 5a |

---

## 3. Arquitectura

```
src/modules/admin/                           NUEVO MODULE
  admin.module.ts                            CREATE: registra SettingsController + SettingsService
  settings/
    settings.controller.ts                   CREATE: GET + PATCH
    settings.controller.test.ts              CREATE: 6 supertest
    settings.service.ts                      CREATE: get + update
    settings.service.test.ts                 CREATE: 4 unit tests (Prisma mocks)
    settings.dto.ts                          CREATE: SettingsUpdateSchema (.strict.refine)
    responses/
      settings.mapper.ts                     CREATE: Decimal → fixed string

src/app.module.ts                            MODIFY: import AdminModule

openapi.json                                 REGENERATE + COMMIT
```

**No SQL migration.** All `Setting` columns exist from Slice 0; permission `settings.manage` is seeded for admin.

**Reuses prior infra:**
- `AuditService.recordChange({ tx })` for diff-format audit (same shape as Slice 4d).
- `prisma.$transaction` for atomicity.
- `JwtAuthGuard` runs unconditionally (sets `req.user`).
- `PermissionsGuard` only fires when `@RequirePermission` is present (so `GET` is unguarded by perm).

---

## 4. Endpoints

### 4.1 `GET /api/settings`

- **Permission:** ninguna explícita (cualquier usuario autenticado vía JWT).
- **HTTP:** 200.
- **Response:**

```ts
{
  default_sweep_rate: "0.080000",
  shortfall_warning_threshold: "0.005000",
  concentration_warning_threshold: "0.150000",
  updated_at: "2026-05-07T12:00:00.000Z",
  updated_by: { id: "...", email: "...", full_name: "..." } | null,
}
```

### 4.2 `PATCH /api/settings`

- **Permission:** `settings.manage` (admin only).
- **HTTP:** 200.
- **Body (Zod `.strict().refine(...)`):**

```ts
z.object({
  default_sweep_rate: z.coerce.number().min(0).max(0.999999).optional(),
  shortfall_warning_threshold: z.coerce.number().min(0).max(1).optional(),
  concentration_warning_threshold: z.coerce.number().min(0).max(1).optional(),
}).strict().refine(d => Object.keys(d).length > 0, {
  message: 'Debe enviar al menos un campo a actualizar',
})
```

- **Response:** mismo shape que `GET /api/settings`, con valores actualizados.

### 4.3 Matriz de errores

| Code | Cuándo |
|---|---|
| 400 | Zod: clave desconocida (e.g., `id`), body vacío, valor fuera de rango |
| 401 | sin JWT |
| 403 | rol sin `settings.manage` (operator/auditor) |
| 404 | row singleton no existe (defensive — debería estar seedeado en 006_seeds.sql) |

Mensajes de negocio en **español**.

---

## 5. Service `get` + `update`

```ts
async get() {
  const row = await this.prisma.setting.findUnique({
    where: { id: 1 },
    include: { updated_by: true },
  });
  if (!row) throw new NotFoundException('Configuración del sistema no encontrada');
  return toSettings(row as unknown as SettingsRow);
}

async update(input: SettingsUpdate, actorId: string) {
  return await this.prisma.$transaction(async (tx) => {
    const existing = await tx.setting.findUnique({
      where: { id: 1 },
      include: { updated_by: true },
    });
    if (!existing) throw new NotFoundException('Configuración del sistema no encontrada');

    const editableFields: Array<keyof SettingsUpdate> = [
      'default_sweep_rate',
      'shortfall_warning_threshold',
      'concentration_warning_threshold',
    ];

    const changed: Record<string, { from: string; to: string }> = {};
    const data: Prisma.SettingUncheckedUpdateInput = {};
    for (const k of editableFields) {
      if (!(k in input)) continue;
      const next = new Prisma.Decimal(input[k] as number);
      const prev = (existing as Record<string, unknown>)[k] as Prisma.Decimal;
      if (!prev.equals(next)) {
        changed[k] = { from: prev.toFixed(6), to: next.toFixed(6) };
        (data as Record<string, unknown>)[k] = next;
      }
    }

    if (Object.keys(changed).length === 0) {
      return toSettings(existing as unknown as SettingsRow);
    }

    const updated = await tx.setting.update({
      where: { id: 1 },
      data: { ...data, updated_at: new Date(), updated_by_id: actorId },
      include: { updated_by: true },
    });

    await this.audit.recordChange({
      entityType: 'settings',
      entityId: '1',
      action: 'update',
      actorId,
      payload: { changed },
      tx,
    });

    return toSettings(updated as unknown as SettingsRow);
  });
}
```

**Audit payload shape:**

```json
{
  "changed": {
    "default_sweep_rate": { "from": "0.080000", "to": "0.090000" }
  }
}
```

**Decimal precision:** `.toFixed(6)` matches the `Decimal(7,6)` DB column precision and the mapper's serialization. JSON's loose number representation could lose precision; stringification preserves exact representation.

---

## 6. DTO + Mapper

### 6.1 `settings.dto.ts`

```ts
import { z } from 'zod';

export const SettingsUpdateSchema = z
  .object({
    default_sweep_rate: z.coerce.number().min(0).max(0.999999).optional(),
    shortfall_warning_threshold: z.coerce.number().min(0).max(1).optional(),
    concentration_warning_threshold: z.coerce.number().min(0).max(1).optional(),
  })
  .strict()
  .refine(
    (d) => Object.keys(d).length > 0,
    { message: 'Debe enviar al menos un campo a actualizar' },
  );

export type SettingsUpdate = z.infer<typeof SettingsUpdateSchema>;
```

### 6.2 `responses/settings.mapper.ts`

```ts
import type { Decimal } from '@prisma/client/runtime/library';

export type SettingsRow = {
  id: number;
  default_sweep_rate: Decimal;
  shortfall_warning_threshold: Decimal;
  concentration_warning_threshold: Decimal;
  updated_at: Date;
  updated_by: { id: string; email: string; full_name: string } | null;
};

export function toSettings(s: SettingsRow) {
  return {
    default_sweep_rate: s.default_sweep_rate.toFixed(6),
    shortfall_warning_threshold: s.shortfall_warning_threshold.toFixed(6),
    concentration_warning_threshold: s.concentration_warning_threshold.toFixed(6),
    updated_at: s.updated_at.toISOString(),
    updated_by: s.updated_by
      ? { id: s.updated_by.id, email: s.updated_by.email, full_name: s.updated_by.full_name }
      : null,
  };
}
```

(`id` not exposed — singleton; the frontend doesn't need it.)

---

## 7. Controller

```ts
import { Body, Controller, Get, HttpCode, HttpStatus, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import type { AuthUser } from '../../auth/types';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { SettingsService } from './settings.service';
import { SettingsUpdateSchema, type SettingsUpdate } from './settings.dto';

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  get() {
    return this.settings.get();
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('settings.manage')
  update(
    @Body(new ZodValidationPipe(SettingsUpdateSchema)) body: SettingsUpdate,
    @CurrentUser() user: AuthUser,
  ) {
    return this.settings.update(body, user.id);
  }
}
```

---

## 8. Module wiring

`src/modules/admin/admin.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { SettingsController } from './settings/settings.controller';
import { SettingsService } from './settings/settings.service';

@Module({
  controllers: [SettingsController],
  providers: [SettingsService],
})
export class AdminModule {}
```

`src/app.module.ts` — add `AdminModule` to imports array.

---

## 9. Tests

### 9.1 `settings.service.test.ts` (~4)

| # | Scenario |
|---|---|
| 1 | `get` returns seeded settings (Decimal serialization to `.toFixed(6)`, updated_by populated) |
| 2 | `update` happy: changes 1 rate + 1 threshold; tx.setting.update called with diff + updated_at + updated_by_id; audit payload has `{ changed: { field: { from, to } } }` with stringified values |
| 3 | `update` no-op: client sends current value → no DB write, no audit, returns current shape |
| 4 | `update` 404 when settings row missing |

### 9.2 `settings.controller.test.ts` (~6)

| # | Scenario |
|---|---|
| 1 | `GET /api/settings` → 401 without token |
| 2 | `GET /api/settings` → 200 happy (any authenticated user; no perm decorator) |
| 3 | `PATCH /api/settings` → 401 without token |
| 4 | `PATCH /api/settings` → 403 when role lacks `settings.manage` (operator) |
| 5 | `PATCH /api/settings` → 200 happy (admin) |
| 6 | `PATCH /api/settings` → 400 when body has unknown key (Zod strict) |

**Total nuevo:** ~10 tests. Total post-5a: 239 + 10 ≈ 249.

### 9.3 Smoke real

The settings row exists (seeded). The test user is `operator`; we promote to admin temporarily.

1. Promote test user: `UPDATE cfb.users SET role='admin' WHERE auth_user_id='4bba7f81-443c-47b2-9bec-bc5a502380cc';`
2. Boot dev server, mint JWT.
3. **GET /api/settings** → 200 with current values (`default_sweep_rate: "0.080000"`, thresholds at default).
4. **PATCH /api/settings** with `{ default_sweep_rate: 0.09 }` → 200 with new value + `updated_by` populated.
5. **POST /api/certificates/sweep/simulate** with `term_days=14, issue_date=<friday>` → response shows `inputs.rate: "0.090000"` (settings default picked up).
6. **PATCH /api/settings** with `{ default_sweep_rate: 0.08 }` → 200 (revert).
7. **PATCH /api/settings** with `{ default_sweep_rate: 1.5 }` → 400 (Zod range).
8. **PATCH /api/settings** with `{ id: 99 }` → 400 (Zod strict).
9. **PATCH /api/settings** with `{}` → 400 (Zod refine).
10. Demote: `UPDATE cfb.users SET role='operator' WHERE ...`.
11. Verify `audit_log`:
    ```sql
    SELECT entity_type, entity_id, action, payload->'changed' AS changed
    FROM cfb.audit_log WHERE entity_type='settings' ORDER BY occurred_at DESC LIMIT 5;
    ```
    Expected: 2 rows (0.09 set + 0.08 revert) with `default_sweep_rate: { from: "0.080000", to: "0.090000" }` (and reverse).

Stop server.

---

## 10. Observabilidad

- **Audit log:** una fila por cada PATCH exitoso que produjo cambios reales, `entity_type='settings'`, `action='update'`, payload formato diff.
- **No-op (sin cambios reales):** sin audit row, sin write — el endpoint retorna el shape actual con HTTP 200.
- **Pino structured logs:** **deferred** (consistente con Slices 3/4a/4b/4c/4d).

---

## 11. Acceptance criteria

- [ ] `GET /api/settings` y `PATCH /api/settings` expuestos.
- [ ] `pnpm test` ≈ 249 verde.
- [ ] `pnpm exec tsc --noEmit` clean.
- [ ] `pnpm lint` clean.
- [ ] Smoke real ejecutado: GET/PATCH/sweep-rate-pickup/revert/Zod-validation/audit-log verificados.
- [ ] `openapi.json` regenerado y commited.
- [ ] Sin nuevas dependencias. Sin migración SQL.
- [ ] `AdminModule` registrado en `AppModule`.

---

## 12. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Race entre dos PATCH simultáneos al settings | Last-write-wins (singleton — alta improbabilidad de conflicto real con 3 admins). Audit log preserva ambos cambios |
| Admin sets `default_sweep_rate` a un valor irracional dentro del rango (e.g. 0.5 = 50%) | Audit log lo registra; sweep posterior refleja el valor; admin puede revertir vía PATCH. Sin guardrails extra (Q2 elegimos rango de negocio, no rango opinionado) |
| Settings row no existe en la DB | 404 explícito con mensaje claro; debería estar seedeado pero defensivo |
| Frontend cachea settings y queda stale tras un PATCH de otro admin | Frontend re-fetchea settings al abrir el admin panel; OR vive con stale data por unos segundos. Eventually consistent — settings son slow-changing |

---

## 13. Out of scope (para slices siguientes)

- **Slice 5b — Audit log query API:** `GET /api/audit` paginated con filtros (entity_type, action, actor, date range). Read-only.
- **Slice 5c — Role-permissions matrix:** GET matrix view + PUT/DELETE grant/revoke endpoints.
- **Slice 6+ — Notifications:** email al inversor cuando se cancela/edita su cert/datos.
- **Pino structured logs:** cross-cutting refactor; aplica a todos los slices previos.
- **Batch archive endpoint:** soft-delete o archive de batches viejos.
- **Frontend-only views:** "certificados cancelados", "inversores desactivados" — el backend ya soporta vía `?include_deleted=true` (Slice 4c) y `?status=inactive` (Slice 4a).
