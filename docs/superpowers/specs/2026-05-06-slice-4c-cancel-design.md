# Slice 4c — Cancel certificate (soft-delete + free orders + audit)

**Estado:** approved · 2026-05-06
**Repo:** `araguaney_back`
**Depende de:** Slice 0 (DB schema con `cfb.certificates.deleted_*` + `cfb.certificate_orders.released_*` + `certificate_status='cancelled'` + permisos `certificate.cancel`/`certificate.read_deleted` seedeados), Slice 1 (auth/permissions), Slice 4a (CertificatesService base), Slice 4b (sweep — sweeps son cancellables con el mismo flow).

---

## 1. Alcance

Slice 4c agrega la **cancelación de certificados emitidos**: el admin marca el certificado como `cancelled`, libera las órdenes asignadas (`released_at` + `released_reason`), las regresa al pool (`status='available'`), inserta un `certificate_event 'cancelled'` y deja una fila en `audit_log`. Aplica indistintamente a certificados standard y sweep.

Adicionalmente, extiende los endpoints de lectura (`GET /api/certificates` y `GET /api/certificates/:id`) para que portadores del permiso `certificate.read_deleted` puedan ver certificados cancelados pasando `?include_deleted=true`.

Incluye una migración SQL pequeña que convierte el `UNIQUE` duro de `certificate_orders.order_id` en un partial unique (`WHERE released_at IS NULL`), permitiendo re-pool de órdenes cuya asignación previa fue liberada.

**Excluye:** edición de inversores (Slice 4d), edición de configuración global / admin UI (Slice 5), notificaciones por email al inversor cuando se cancela (Slice 5+).

---

## 2. Decisiones tomadas (no re-discutir)

| # | Decisión | Justificación |
|---|---|---|
| 1 | Solo certificados con `status='issued'` son cancelables | Matured = settled; cancel post-maturity es un caso regulatorio raro que se hace por DB intervention con audit context |
| 2 | `reason` requerido, free-text, `min 5 max 1000` chars | Audit-heavy event; min-5 evita placeholders como `'.'`; libre para que el admin describa el contexto real |
| 3 | Endpoint: `POST /api/certificates/:id/cancel` con body `{ reason }` | Cancel es una transición de estado, no DELETE; body-via-POST evita los problemas de DELETE-with-body |
| 4 | Read endpoints aceptan `?include_deleted=true`; sin permiso es ignorado silenciosamente (no 403) | Safe-by-default: un cliente que pasa el flag por error no rompe; un cliente con perm explícito sí lo usa |
| 5 | Concurrencia vía `SELECT ... FOR UPDATE` sobre cert + cert_orders dentro de `prisma.$transaction({ timeout: 30_000 })` | Mismo patrón que Slices 4a/4b; serializa contra issuance concurrente |
| 6 | Migración 009 convierte `UNIQUE(order_id)` en partial unique `WHERE released_at IS NULL` | Sin esto, una orden cancelada nunca podría re-asignarse — destruye el valor de cancel |
| 7 | Cancel de cancel = 404 (no idempotente sobre estado) | Re-cancelar un cert ya cancelado es un bug del cliente; 404 lo expone explícitamente |
| 8 | Cancel sirve igual para standard y sweep — no hay flow separado en SweepService | La lógica es simétrica: liberar órdenes y marcar la fila — el `certificate_type` se preserva en el evento y el audit |
| 9 | Audit `entity_type='certificate'`, `action='cancel'` | Consistente con `entity_type='certificate'` que usa issuance; `action` distingue create vs cancel |
| 10 | Re-cancelación post-migración 009: el partial unique permite que la misma orden entre en un nuevo cert_orders | El primer cert_orders mantiene `released_at` set; el unique solo cuenta filas activas |

---

## 3. Arquitectura

```
src/modules/issuance/certificates/
  certificates.controller.ts             MODIFY: + @Post(':id/cancel'); @Get list/detail toman @CurrentUser para flag include_deleted
  certificates.controller.test.ts        MODIFY: + ~5 tests (cancel matrix + include_deleted)
  certificates.service.ts                MODIFY: + cancel() method ~120 lines; list()/detail() reciben hasReadDeleted: boolean
  certificates.service.test.ts           MODIFY: + ~7 tests (cancel branches + read-deleted gating)
  certificates.dto.ts                    MODIFY: + CertificateCancelSchema; CertificatesListQuerySchema gana include_deleted
  responses/certificate-detail.mapper.ts MODIFY: surface deleted_at / deleted_by / deleted_reason cuando no son null

infra/sql/
  009_cert_orders_partial_unique.sql     CREATE: drop hard UNIQUE, add partial UNIQUE WHERE released_at IS NULL

openapi.json                             REGENERATE + COMMIT
```

**Sin nuevo módulo** — cancel es una transición de estado sobre el entity Certificate; vive en `CertificatesService` junto con simulate/issue/list/detail. El archivo crece a ~560 líneas, manejable.

**Sweep usa el mismo endpoint** — no hay `SweepController.cancel` ni `SweepService.cancel`. La columna `certificate_type` distingue ambos en el audit y el event payload.

**Permisos ya seedeados (Slice 0):**
- `certificate.cancel` → admin (no operator). Operators no cancelan; admins son la escape hatch regulatoria.
- `certificate.read_deleted` → admin + auditor (auditor lee sin modificar).

---

## 4. SQL migration `009_cert_orders_partial_unique.sql`

```sql
-- 009_cert_orders_partial_unique.sql
-- Convert certificate_orders.order_id UNIQUE constraint to a partial unique
-- index so cancelled cert_orders rows (released_at IS NOT NULL) don't block
-- the order from being re-pooled in a new certificate.
--
-- The order indivisibility rule (one active assignment per order) is preserved
-- by the partial index's WHERE clause.
--
-- Idempotent — safe to re-run.
-- Depends on: 004_issuance.sql (cfb.certificate_orders).

BEGIN;

ALTER TABLE cfb.certificate_orders
  DROP CONSTRAINT IF EXISTS certificate_orders_order_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_co_active_order_id
  ON cfb.certificate_orders (order_id)
  WHERE released_at IS NULL;

COMMIT;
```

**Efectos:**
- Una orden puede tener múltiples filas históricas en `cert_orders`, una por cada certificado en el que vivió, pero **a lo más una con `released_at IS NULL`** (assignment activa).
- El flow de issuance (Slices 4a/4b) sigue funcionando sin cambios — al insertar `cert_orders`, la nueva fila es la única activa para ese `order_id`.
- Cancel marca `released_at = now()` y `released_reason = 'cert_cancelled: <reason>'` en las filas activas.
- Re-issuance de la misma orden tras cancel inserta una fila nueva; el partial index la admite porque la previa tiene `released_at IS NOT NULL`.

**Aplicar manualmente** desde Supabase SQL Editor antes de deployar la branch. No hay cambios en `prisma/schema.prisma` (Prisma client no enforce uniques a nivel de tipos).

---

## 5. Endpoint cancel

### 5.1 `POST /api/certificates/:id/cancel`

- **Permission:** `certificate.cancel` (admin only).
- **HTTP:** 200 (transición de estado, no creación).
- **Body (Zod):**
  ```ts
  { reason: z.string().min(5).max(1000) }
  ```
- **Response:**
  ```ts
  {
    id: string,
    certificate_code: string,
    status: 'cancelled',
    cancelled_at: string,           // ISO timestamp
    released_order_count: number,
  }
  ```

### 5.2 Matriz de errores

| Code | Cuándo |
|---|---|
| 400 | Zod validation: `reason < 5` o `> 1000` chars |
| 401 | sin JWT |
| 403 | rol sin `certificate.cancel` (operator/auditor) |
| 404 | cert id no existe O ya está cancelado (`deleted_at IS NOT NULL`) |
| 409 | cert.status != `'issued'` (e.g. `'matured'`); body incluye `current_status` |

Mensajes de negocio en **español**.

---

## 6. Transacción `cancel`

`prisma.$transaction(async (tx) => { ... }, { timeout: 30_000 })`:

1. **Lock cert row** vía `SELECT id, certificate_code, status, certificate_type, deleted_at FROM cfb.certificates WHERE id = $1::uuid FOR UPDATE`. Validar 404 si no existe o `deleted_at` no es null.
2. **Validar status** = `'issued'`; sino 409 con `current_status` en el body.
3. **Lock active cert_orders rows** vía `SELECT id, order_id FROM cfb.certificate_orders WHERE certificate_id = $1::uuid AND released_at IS NULL FOR UPDATE`.
4. **UPDATE certificate** set `status='cancelled'`, `deleted_at=now`, `deleted_by_id=actorId`, `deleted_reason=reason`.
5. **UPDATE certificate_orders.updateMany** set `released_at=now`, `released_reason=\`cert_cancelled: ${reason}\``.
6. **UPDATE orders.updateMany** WHERE id IN released_ids set `status='available'`.
7. **INSERT certificate_events** event_type=`'cancelled'`, payload `{ reason, certificate_type, order_count, cancelled_at }`, `actor_id=actorId`.
8. **`audit.recordChange({ entity_type: 'certificate', action: 'cancel', payload, tx })`** — atómico con la tx.
9. Return `{ id, certificate_code, status: 'cancelled', cancelled_at, released_order_count }`.

**Concurrencia:** dos cancels simultáneos del mismo cert → el segundo bloquea en step 1, después el `deleted_at IS NOT NULL` lo enruta a 404. Standard issue concurrente sobre las mismas órdenes → bloquea en `SELECT FOR UPDATE` de orders en el otro tx; tras commit del cancel, ve `status='available'` y procede normalmente — re-pool válido vía partial unique.

---

## 7. Read endpoints `?include_deleted=true`

### 7.1 DTO extension

`CertificatesListQuerySchema.extend({ include_deleted: z.coerce.boolean().optional().default(false) })`.

### 7.2 Comportamiento

| Caller `read_deleted` | `?include_deleted` | Efecto |
|---|---|---|
| no | absent / false | Excluye cancelados (default actual de Slice 4a) |
| no | true | **Sigue excluyendo** — flag ignorado silenciosamente |
| yes | absent / false | Excluye cancelados (default-safe) |
| yes | true | Incluye cancelados |

### 7.3 Implementación

`CertificatesService.list(query, hasReadDeleted: boolean)` — cambia una línea:

```ts
const where: Prisma.CertificateWhereInput = {};
if (!query.include_deleted || !hasReadDeleted) {
  where.deleted_at = null;
}
```

`CertificatesService.detail(id, hasReadDeleted: boolean)`:

```ts
if (!c) throw new NotFoundException('Certificado no encontrado');
if (c.deleted_at !== null && !hasReadDeleted) {
  throw new NotFoundException('Certificado no encontrado');
}
```

`CertificatesController` extrae el flag del CurrentUser y lo pasa explícitamente:

```ts
list(query, @CurrentUser() user) {
  return this.certificates.list(query, user.permissions.has('certificate.read_deleted'));
}
```

(La forma exacta de `user.permissions` se valida durante la implementación contra el shape actual de `AuthUser`.)

### 7.4 Detail mapper

`certificate-detail.mapper.ts` ya tiene `CertificateDetailRow` con campos opcionales — al implementar, exponer cuando no son null:

```ts
{
  ...summary,
  // ...existing fields...
  cancellation: c.deleted_at ? {
    cancelled_at: c.deleted_at.toISOString(),
    cancelled_by: c.deleted_by
      ? { id: c.deleted_by.id, email: c.deleted_by.email, full_name: c.deleted_by.full_name }
      : null,
    reason: c.deleted_reason,
  } : null,
}
```

(Si `deleted_at` es null, `cancellation: null` — explicit, frontend-friendly.)

---

## 8. Observabilidad

- **certificate_events:** una fila `event_type='cancelled'` por cert cancelado, payload con `reason`, `certificate_type`, `order_count`, `cancelled_at`.
- **audit_log:** una fila `entity_type='certificate'`, `action='cancel'`, payload con `certificate_code`, `certificate_type`, `reason`, `order_count`, `released_order_ids`.
- **Pino structured logs:** **deferred** (consistente con Slices 3/4a/4b).

---

## 9. Tests

### 9.1 `certificates.service.test.ts` (~7 nuevos)

| # | Scenario |
|---|---|
| 1 | `cancel` happy: cert → cancelled, cert_orders → released, orders → available, event 'cancelled', audit row |
| 2 | `cancel` 404 cuando cert id no existe |
| 3 | `cancel` 404 cuando cert ya cancelado |
| 4 | `cancel` 409 con `current_status` cuando cert es `matured` |
| 5 | `list` incluye cancelados cuando `include_deleted=true` AND `hasReadDeleted=true` |
| 6 | `list` excluye cancelados cuando `include_deleted=true` BUT `hasReadDeleted=false` (silent) |
| 7 | `detail` 404 cuando cert es cancelado y `hasReadDeleted=false` |

### 9.2 `certificates.controller.test.ts` (~5 nuevos)

| # | Scenario |
|---|---|
| 1 | `POST /:id/cancel` → 401 sin token |
| 2 | `POST /:id/cancel` → 403 cuando rol sin `certificate.cancel` (operator) |
| 3 | `POST /:id/cancel` → 200 happy (admin) |
| 4 | `POST /:id/cancel` → 400 cuando reason < 5 chars |
| 5 | `GET /api/certificates?include_deleted=true` propaga el flag al service cuando caller tiene `certificate.read_deleted` |

**Total nuevo:** ~12 tests. Total post-4c: 216 + 12 ≈ 228.

### 9.3 Smoke real

Cert `C4573A` (sweep, emitido en smoke de 4b) está `'issued'` con 2 órdenes asignadas. Es el target ideal para cancel.

1. Aplicar migración `009_cert_orders_partial_unique.sql` en Supabase. Verificar:
   ```sql
   SELECT indexname FROM pg_indexes
   WHERE schemaname='cfb' AND tablename='certificate_orders' AND indexname='uq_co_active_order_id';
   ```
2. Bootear `pnpm dev`, mintear JWT del test user (`4bba7f81-443c-47b2-9bec-bc5a502380cc`).
3. **Como operator:** `POST /api/certificates/<C4573A id>/cancel` con `{ reason: 'Smoke test 4c' }` → **403**.
4. Promover test user a admin: `UPDATE cfb.users SET role='admin' WHERE auth_user_id='<sub>';`
5. **Como admin:** mismo POST → **200** con `released_order_count: 2`.
6. **Repetir el POST** → **404** (ya cancelado).
7. Verificar en DB:
   ```sql
   SELECT status, deleted_at IS NOT NULL FROM cfb.certificates WHERE certificate_code='C4573A';   -- cancelled / true
   SELECT count(*) FROM cfb.certificate_orders WHERE certificate_id=<id> AND released_at IS NOT NULL;  -- 2
   SELECT count(*) FROM cfb.orders WHERE id IN (...) AND status='available';                      -- 2
   SELECT event_type FROM cfb.certificate_events WHERE certificate_id=<id> ORDER BY occurred_at DESC LIMIT 1;  -- cancelled
   SELECT count(*) FROM cfb.audit_log WHERE entity_type='certificate' AND action='cancel';        -- 1
   ```
8. **Como admin:** `GET /api/certificates?include_deleted=true` → C4573A aparece.
9. **Como admin:** `GET /api/certificates/<id>?include_deleted=true` → 200 con `status='cancelled'`, `cancellation.reason='Smoke test 4c'`, eventos completos.
10. Revertir test user a operator: `UPDATE cfb.users SET role='operator' WHERE auth_user_id='<sub>';`

---

## 10. Acceptance criteria

- [ ] `infra/sql/009_cert_orders_partial_unique.sql` aplicada en live Supabase.
- [ ] `POST /api/certificates/:id/cancel` expuesto.
- [ ] `GET /api/certificates` y `GET /api/certificates/:id` aceptan `?include_deleted=true` con permiso.
- [ ] `pnpm test` ≈ 228 verde.
- [ ] `pnpm exec tsc --noEmit` clean.
- [ ] `pnpm lint` clean.
- [ ] Smoke real ejecutado: 403 / 200 / 404 / DB verifications OK.
- [ ] `openapi.json` regenerado y commited.
- [ ] Sin nuevas dependencias. Sin cambios al `schema.prisma` (solo migración SQL).

---

## 11. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Operador olvida aplicar la migración 009 antes del primer cancel en prod | Acceptance criteria; smoke step 1 verifica index existence; cancel sin migración fallaría en re-pool de orden, no en cancel mismo |
| Cancel concurrente con issue de otro cert sobre las mismas órdenes | `SELECT FOR UPDATE` en cert + cert_orders + orders serializa; el orden de los locks coincide con issuance, evitando deadlocks |
| Cancel doble simultáneo del mismo cert | Primer tx commits el `deleted_at`; segundo bloquea, ve `deleted_at IS NOT NULL`, retorna 404 |
| Cancel de un cert con muchas órdenes (sweep grande, e.g. 1500 órdenes) | `updateMany` es eficiente; el lock granular se mantiene; timeout 30s da margen |
| Operator descubre cómo escalarse a admin para cancelar | `certificate.cancel` está en role_permissions, no en JWT; UPDATE de role es auditable; fuera del scope de Slice 4c |
| `cancellation: null` en response de detail confunde al frontend | Nullable explícito siempre presente — frontend hace `if (cert.cancellation) { ... }`; ergonómico vs propiedad ausente |

---

## 12. Out of scope (para slices siguientes)

- **Slice 4d — Investor update:** `PATCH /api/investors/:id` para legal_name/email/phone/notes/status (NO RIF, NO kind).
- **Slice 5 — Admin:** edición de `cfb.settings` desde UI con audit, gestión de matriz `role_permissions`, dashboard de `audit_log`, vista dedicada de "certificados cancelados" con filtros de fecha + razón.
- **Notificaciones por cancel:** email al inversor cuando su cert es cancelado — Slice 5+.
- **"Uncancel" / restore:** intencionalmente fuera de scope. Cancel es one-way.
- **Cancel de matured certs:** caso regulatorio raro; cuando ocurra, se hace por DB intervention con audit context, no por API.
- **Pino structured logs sobre eventos de cancel:** deferred consistentemente.
