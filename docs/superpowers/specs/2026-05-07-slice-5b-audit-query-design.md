# Slice 5b — Audit log query API

**Estado:** approved · 2026-05-07
**Repo:** `araguaney_back`
**Depende de:** Slice 0 (DB schema con `cfb.audit_log` + 4 índices + permiso `audit.read` seedeado), Slice 1 (auth/permissions), Slice 5a (AdminModule existente).

---

## 1. Alcance

Slice 5b expone el `cfb.audit_log` vía un endpoint paginado read-only:
- `GET /api/audit` — gated por `audit.read` (operator + admin + auditor).

Filtros: `entity_type` + `entity_id`, `actor_id`, `action`, `occurred_at_from`/`occurred_at_to`. Sort fijo `occurred_at DESC`. Actor expandido inline (`{ id, email, full_name }` o null). Payload completo pass-through (sin truncate).

Es la segunda de las 3 sub-slices de Slice 5 (admin features). La siguiente es **5c — Role-permissions matrix management**.

**Excluye:** writes al audit_log (siempre via `AuditService.recordChange` desde otros services — el log es append-only enforced por trigger DB), text search en payload (Slice futuro si product validation pide), `GET /api/audit/:id` detail endpoint (no hay UX que lo justifique today), notificaciones, vistas frontend filtradas.

---

## 2. Decisiones tomadas (no re-discutir)

| # | Decisión | Justificación |
|---|---|---|
| 1 | 5 filtros (entity_type/id, actor_id, action, date range) + sort fijo `occurred_at DESC` | Cubre los 4 índices existentes; auditor toolkit completo sin q-search |
| 2 | Actor expandido inline `{ id, email, full_name } \| null` | Single LEFT JOIN cheap; evita 50 follow-up requests del frontend |
| 3 | Payload completo siempre (sin truncate) | Realistic max ~80KB por sweep cancel grande; con 50 rows worst case ~4MB pero average es KB. Si crece, agregar `:id` + truncate en slice posterior |
| 4 | `entity_id` requiere `entity_type` (Zod refine) | Sin entity_type, query degrada a table scan; el índice es composite |
| 5 | Endpoint en nuevo path `src/modules/admin/audit/` con servicio `AuditQueryService` | Evita colisión con `AuditService` write-side (Slice 3); separación read vs write semánticamente clara |
| 6 | Reusa `AdminModule` (Slice 5a) — no nuevo module | Coincide con la idea original "admin features" en una sola home |
| 7 | Pagination via `PaginationSchema` existente (limit/offset) | Mismo patrón que GET /api/certificates, /api/investors, etc. |
| 8 | `Promise.all([findMany, count])` para data + total | Mismo patrón establecido en list endpoints anteriores |
| 9 | `Prisma.AuditLogWhereInput` sin Decimal — todo string/uuid/date | audit_log no contiene campos monetarios |

---

## 3. Arquitectura

```
src/modules/admin/                          (existing from Slice 5a)
  audit/                                     NEW SUB-FEATURE
    audit.controller.ts                      CREATE: GET /api/audit
    audit.controller.test.ts                 CREATE: 5 supertest
    audit.service.ts                         CREATE: AuditQueryService.list
    audit.service.test.ts                    CREATE: 5 unit tests
    audit.dto.ts                             CREATE: AuditListQuerySchema
    responses/
      audit-entry.mapper.ts                  CREATE: row → response shape
  admin.module.ts                            MODIFY: register AuditController + AuditQueryService

openapi.json                                 REGENERATE + COMMIT
```

**Naming nuance:** Existing `AuditService` lives at `src/modules/audit/audit.service.ts` (Slice 3) and writes audit rows from other services via `recordChange()`. The new service we add here reads them. To avoid name collision the new service is `AuditQueryService` and lives under `admin/audit/`. Clean separation: write-side stays general infrastructure; read-side is admin feature.

**Reuses Slice 5a's `AdminModule`** as the module home. AdminModule grows to wire two controllers + two services after this slice.

**Permission `audit.read`** already seeded for **operator + admin + auditor** (per `006_seeds.sql`). All three roles can read — auditor in particular needs this for forensic review.

**No SQL migration.** All 4 indexes exist:
- `idx_audit_occurred` — `(occurred_at DESC)` for default sort.
- `idx_audit_actor` — `(actor_id, occurred_at DESC)` for actor filter.
- `idx_audit_entity` — `(entity_type, entity_id)` for entity composite filter.
- `idx_audit_action` — `(action)` for action filter.

The Prisma planner picks the right index at query time based on which filters are present.

---

## 4. Endpoint

### 4.1 `GET /api/audit`

- **Permission:** `audit.read` (operator + admin + auditor).
- **HTTP:** 200.
- **Query (Zod):**

```ts
PaginationSchema.extend({
  entity_type: z.enum([
    'batch','order','installment','certificate','certificate_order',
    'investor','merchant','end_user','user','setting','system',
  ]).optional(),
  entity_id: z.string().min(1).max(50).optional(),
  actor_id: z.string().uuid().optional(),
  action: z.string().min(1).max(50).optional(),
  occurred_at_from: z.coerce.date().optional(),
  occurred_at_to: z.coerce.date().optional(),
}).refine(
  (d) => !d.entity_id || d.entity_type !== undefined,
  { message: 'entity_id requiere entity_type', path: ['entity_id'] },
)
```

- **Response:**

```ts
{
  data: [
    {
      id: string,
      occurred_at: string,         // ISO timestamp
      actor: { id, email, full_name } | null,
      action: string,              // 'create' | 'update' | 'cancel' | etc
      entity_type: string,         // 'investor' | 'certificate' | 'setting' | etc
      entity_id: string | null,
      ip_address: string | null,
      user_agent: string | null,
      payload: unknown,            // full JSON, pass-through
    }
  ],
  total: number,
  limit: number,
  offset: number,
}
```

### 4.2 Matriz de errores

| Code | Cuándo |
|---|---|
| 400 | Zod: `entity_type` fuera del enum, malformed UUID, malformed date, `entity_id` sin `entity_type` (refine), limit/offset fuera de rango |
| 401 | sin JWT |
| 403 | rol sin `audit.read` |

Mensajes en **español** donde sean user-facing (refine message). Errores Zod estándar generados por la validation pipe.

---

## 5. Service `list`

```ts
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
      if (query.occurred_at_from) (where.occurred_at as Record<string, Date>).gte = query.occurred_at_from;
      if (query.occurred_at_to) (where.occurred_at as Record<string, Date>).lte = query.occurred_at_to;
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
```

**Notes:**
- `Promise.all([findMany, count])` — count ignores `take/skip` and reflects the unfiltered total for the active `where`.
- `Prisma.AuditLogWhereInput` typed; the `(where.occurred_at as Record<string, Date>)` cast is a known pragmatic pattern (same as Slice 4a's `CertificatesListQuerySchema` date range).
- `include: { actor: true }` produces a single LEFT JOIN; no N+1.

---

## 6. Mapper

`responses/audit-entry.mapper.ts`:

```ts
export type AuditEntryRow = {
  id: string;
  occurred_at: Date;
  actor_id: string | null;
  actor: { id: string; email: string; full_name: string } | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  payload: unknown;
};

export function toAuditEntry(r: AuditEntryRow) {
  return {
    id: r.id,
    occurred_at: r.occurred_at.toISOString(),
    actor: r.actor
      ? { id: r.actor.id, email: r.actor.email, full_name: r.actor.full_name }
      : null,
    action: r.action,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    ip_address: r.ip_address,
    user_agent: r.user_agent,
    payload: r.payload,
  };
}
```

`actor_id` not separately exposed — `actor.id` carries the same info.

---

## 7. Controller

```ts
import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { AuditQueryService } from './audit.service';
import { AuditListQuerySchema, type AuditListQuery } from './audit.dto';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditQueryService) {}

  @Get()
  @RequirePermission('audit.read')
  list(@Query(new ZodValidationPipe(AuditListQuerySchema)) query: AuditListQuery) {
    return this.audit.list(query);
  }
}
```

**Pipe placement is parameter-level** (`@Query(new ZodValidationPipe(...))`) — consistent with the post-Slice-4c convention that fixed the method-level `@UsePipes` bug.

---

## 8. Module wiring

`src/modules/admin/admin.module.ts` — extend the existing module:

```ts
import { Module } from '@nestjs/common';
import { SettingsController } from './settings/settings.controller';
import { SettingsService } from './settings/settings.service';
import { AuditController } from './audit/audit.controller';
import { AuditQueryService } from './audit/audit.service';

@Module({
  controllers: [SettingsController, AuditController],
  providers: [SettingsService, AuditQueryService],
})
export class AdminModule {}
```

`AppModule` already imports `AdminModule` (Slice 5a) — no change.

---

## 9. Tests

### 9.1 `audit.service.test.ts` (~5)

| # | Scenario |
|---|---|
| 1 | `list` returns paginated rows mapped via `toAuditEntry` (actor expanded, payload pass-through) |
| 2 | `list` with no filters: where is empty, orderBy occurred_at desc, total returned |
| 3 | `list` with `entity_type='setting' + entity_id='1'`: where has both |
| 4 | `list` with `actor_id` and date range: where has actor_id and occurred_at { gte, lte } |
| 5 | `list` returns empty `data: []` when count is 0 |

### 9.2 `audit.controller.test.ts` (~5)

| # | Scenario |
|---|---|
| 1 | `GET /api/audit` → 401 without token |
| 2 | `GET /api/audit` → 403 when role lacks `audit.read` |
| 3 | `GET /api/audit` → 200 happy (operator role; audit.read seeded) |
| 4 | `GET /api/audit?entity_id=foo` → 400 (Zod refine: entity_id without entity_type) |
| 5 | `GET /api/audit?entity_type=settings_plural` → 400 (Zod enum — typo) |

**Total nuevo:** ~10 tests. Total post-5b: 250 + 10 ≈ 260.

### 9.3 Smoke real

audit_log has rich pre-existing data from Slices 4b/4c/4d/5a smokes (sweep emission, cert cancel, investor updates, settings updates).

The test user (sub `4bba7f81-443c-47b2-9bec-bc5a502380cc`) is `role='operator'`, which has `audit.read` seeded — **no role promotion needed.**

1. Boot dev server, mint JWT.
2. **GET /api/audit** (no filters) → 200, `total > 0`, `data` shows latest by `occurred_at DESC`. Verify actor expansion in at least one row.
3. **GET /api/audit?entity_type=setting&entity_id=1** → 200, returns 2 setting-update rows from Slice 5a's smoke.
4. **GET /api/audit?action=update&entity_type=investor** → 200, returns the 3 investor-update rows from Slice 4d's smoke (1 external + 2 internal).
5. **GET /api/audit?actor_id=<test-user-uuid>** → 200, all rows where the test user was the actor (lookup the test user's id via Supabase MCP first).
6. **GET /api/audit?occurred_at_from=2026-05-06&occurred_at_to=2026-05-08** → 200, recent entries within the smoke timeline.
7. **GET /api/audit?entity_id=foo** → 400 ("entity_id requiere entity_type").
8. **GET /api/audit?entity_type=settings_plural** → 400 (enum).
9. **GET /api/audit?limit=5&offset=0** → 200, exactly 5 rows + total.

Stop server.

---

## 10. Observabilidad

- **No nuevo audit row escrito** — este endpoint es read-only. El log se sigue escribiendo desde otros services via `AuditService.recordChange`.
- **Pino structured logs:** **deferred** (consistente con todos los slices previos).

---

## 11. Acceptance criteria

- [ ] `GET /api/audit` expuesto con todos los filtros + paginación.
- [ ] `pnpm test` ≈ 260 verde.
- [ ] `pnpm exec tsc --noEmit` clean.
- [ ] `pnpm lint` clean.
- [ ] Smoke real ejecutado: 200/400 verificados; al menos 1 query con cada filtro retorna data esperada.
- [ ] `openapi.json` regenerado y commited.
- [ ] `AdminModule` registra ambos controllers (Settings + Audit).
- [ ] Sin nuevas dependencias. Sin migración SQL.

---

## 12. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Sweep cancel con 2000 órdenes produce un row de ~80KB; 50 rows/page worst-case ~4MB | Realistic average is KB. If becomes issue, add truncation + `GET /api/audit/:id` in future slice |
| `entity_id` typo bypassa el index composite (table scan) | Refine forces `entity_type` to be present when `entity_id` is set |
| Auditor con `audit.read` ve PII en payload (e.g. emails de inversores) | Auditor role exists by design — purpose-built for forensic review. PII visibility está en scope del rol |
| Sync entre Zod enum `AUDIT_ENTITY_TYPES` y TypeScript union `AuditEntityType` (audit/types.ts) | Comment en cada uno apuntando al otro; futura slice puede unificar |
| `actor_id` con valor `null` (system events) | Manejado en mapper: `actor: null` cuando no hay relación |

---

## 13. Out of scope (para slices siguientes)

- **Slice 5c — Role-permissions matrix:** GET matrix view + PUT/DELETE grant/revoke endpoints.
- **GET /api/audit/:id detail endpoint:** sin product use case today; agregar cuando frontend lo pida.
- **Text search en payload:** Postgres `@>` o GIN-indexed jsonb queries; agregar cuando product valide la necesidad.
- **Export audit log a CSV / JSON:** UI feature; backend ya provee paginated read.
- **Pino structured logs sobre eventos audit-read:** deferred consistentemente.
