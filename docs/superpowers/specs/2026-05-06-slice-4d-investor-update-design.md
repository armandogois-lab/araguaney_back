# Slice 4d — Investor PATCH (legal_name / email / phone / notes / status)

**Estado:** approved · 2026-05-06
**Repo:** `araguaney_back`
**Depende de:** Slice 0 (DB schema con `cfb.investors` + permisos `investor.update` seedeado), Slice 1 (auth/permissions), Slice 4a (InvestorsService base con list/detail/create).

---

## 1. Alcance

Slice 4d agrega la **edición parcial de inversores existentes** vía `PATCH /api/investors/:id`. Cubre:
- Campos editables: `legal_name`, `email`, `phone`, `notes`, `status`.
- Campos NO editables (deliberadamente): `rif` (KYC inmutable), `kind` (clasificación estructural inmutable), `id`, `created_at`, `created_by_id`.
- Reglas especiales para el inversor interno (`kind='internal'`, el seedeado "Grupo Cashea Ve C.A."): su `status` está bloqueado (no puede ir a `inactive`); su `legal_name` y campos de contacto son editables.
- Migración SQL pequeña que agrega `updated_at` y `updated_by_id` a `cfb.investors` para que el frontend pueda mostrar "última edición" sin joinear con audit_log.
- Audit log en formato diff (solo campos cambiados, con `from` y `to`).

**Excluye:** edición de `rif` o `kind` (cualquier cambio de RIF requiere SQL admin / KYC re-validation, fuera de scope), eliminación de inversores (no aplica — Cashea no borra inversores; los desactiva), edición masiva (1 inversor a la vez), notificaciones por email al inversor cuando se editan sus datos (Slice 5+).

---

## 2. Decisiones tomadas (no re-discutir)

| # | Decisión | Justificación |
|---|---|---|
| 1 | Endpoint `PATCH /api/investors/:id` con body parcial | RFC 5789-friendly; los 5 campos son independientes; PUT verboso |
| 2 | Body Zod `.strict().refine(len > 0)`: rechaza claves desconocidas y body vacío | Catch frontend bugs early; mensaje en español "Debe enviar al menos un campo a actualizar" |
| 3 | Status transitions libres para inversores externos (active ⇄ inactive) | Tesorería conoce el contexto; un inversor con certs activos que se desactiva es un estado válido |
| 4 | Internal investor (`kind='internal'`): status bloqueado (409) | Sweep depende de `internal AND active`; bloquear en endpoint evita romper sweep silenciosamente |
| 5 | Internal investor: legal_name + email + phone + notes editables | Cashea puede rebrand o cambiar contacto — eventos de negocio normales |
| 6 | Audit log en formato diff: `{ changed: { field: { from, to } } }` | Forensic-friendly: 1-line jq filter responde "qué cambió". Estado completo siempre derivable de la fila actual |
| 7 | Schema migration 010: agrega `updated_at` (NOT NULL DEFAULT now()) + `updated_by_id` (NULL FK) a `cfb.investors`. Backfill desde `created_at`/`created_by_id` | Mirrors el patrón de `cfb.settings`; frontend muestra "última edición" sin joinear audit_log |
| 8 | `updated_at` lo setea el service explícitamente en cada UPDATE — no DB trigger | Triggers son "hidden behavior"; mantener el código y la columna sincronizados desde el mismo path es más auditable |
| 9 | Concurrencia: last-write-wins; sin optimistic locking ni `If-Match` | 3 operadores, edits raros — el costo de UI/protocolo de ETag no se justifica; audit log preserva todos los cambios |
| 10 | Wrap UPDATE + audit en `prisma.$transaction(async (tx) => ...)` | Si el INSERT del audit falla post-UPDATE, ambos rollback — consistente con la convención del proyecto (Slices 4a/4b/4c) |
| 11 | No-op detection: si el cliente manda valores idénticos al actual, no se escribe ni se audita | Audit log queda limpio; idempotente respecto a "request validity" (Q2) pero no genera ruido si nada cambió |

---

## 3. Arquitectura

```
src/modules/issuance/investors/
  investors.controller.ts              MODIFY: + @Patch(':id'); list/detail tocan @CurrentUser solo si update lo necesita (no requerido aquí)
  investors.controller.test.ts         MODIFY: + ~5 tests
  investors.service.ts                 MODIFY: + update() method; private assembleSummary helper (refactor)
  investors.service.test.ts            MODIFY: + ~6 tests
  investors.dto.ts                     MODIFY: + InvestorUpdateSchema (.strict.refine)
  responses/investor-summary.mapper.ts MODIFY: + updated_at, updated_by nested object

prisma/schema.prisma                   MODIFY: Investor model gains updated_at + updated_by_id + named relations
infra/sql/
  010_investors_updated_at.sql         CREATE: ALTER TABLE add 2 columns + backfill + FK

openapi.json                           REGENERATE + COMMIT
```

**No new module.** Update completa CRUD en el `InvestorsService` existente. El archivo crece a ~210 líneas — manageable.

**Permission:** `investor.update` ya seedeado para operator + admin. Auditor no puede editar.

**`assembleSummary` refactor:** list/detail/create/update todos calculan `active_cert_count + total_invested` igual; extraer un private helper evita duplicación 4×. Slice-scope: la duplicación se introdujo en Slice 4a, ahora un cuarto caller justifica el extract.

---

## 4. SQL migration `010_investors_updated_at.sql`

```sql
-- 010_investors_updated_at.sql
-- Add updated_at and updated_by_id columns to cfb.investors so the frontend
-- can show "last edited at / by whom" without joining cfb.audit_log.
--
-- The audit_log remains the source of truth for full change history;
-- these columns are a denormalized convenience for read paths.
--
-- updated_at is set explicitly by the service on every UPDATE — no DB trigger.
-- For pre-existing rows, default to created_at so "last edited" is sensible
-- before any updates happen.
--
-- Idempotent — safe to re-run.
-- Depends on: 003_portfolio.sql (cfb.investors), 001_init.sql (cfb.users).

BEGIN;

ALTER TABLE cfb.investors
  ADD COLUMN IF NOT EXISTS updated_at  timestamptz,
  ADD COLUMN IF NOT EXISTS updated_by_id uuid;

UPDATE cfb.investors
SET updated_at    = COALESCE(updated_at, created_at),
    updated_by_id = COALESCE(updated_by_id, created_by_id);

ALTER TABLE cfb.investors
  ALTER COLUMN updated_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT now();

DO $$ BEGIN
  ALTER TABLE cfb.investors
    ADD CONSTRAINT investors_updated_by_id_fkey
      FOREIGN KEY (updated_by_id) REFERENCES cfb.users(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
```

**Prisma schema** (`prisma/schema.prisma`) — `Investor` model gains 2 fields y named relations (Prisma requires named when 2+ relations point to same model):

```prisma
model Investor {
  // ... existing fields ...
  updated_at    DateTime  @default(dbgenerated("now()")) @db.Timestamptz(6)
  updated_by_id String?   @db.Uuid

  created_by    User? @relation("investor_created_by", fields: [created_by_id], references: [id])
  updated_by    User? @relation("investor_updated_by", fields: [updated_by_id], references: [id])
  certificates  Certificate[]
  // ... rest unchanged ...
}
```

`User` model gains 2 back-relations (`investors_created`, `investors_updated`).

---

## 5. Endpoint

### 5.1 `PATCH /api/investors/:id`

- **Permission:** `investor.update` (operator + admin).
- **HTTP:** 200 (transición de estado / actualización; no creación).
- **Body (Zod `.strict().refine(...)`):**
  ```ts
  z.object({
    legal_name: z.string().min(1).max(255).optional(),
    email: z.string().email().max(255).nullable().optional(),
    phone: z.string().min(1).max(50).nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
    status: z.enum(['active', 'inactive']).optional(),
  }).strict().refine(d => Object.keys(d).length > 0, {
    message: 'Debe enviar al menos un campo a actualizar',
  })
  ```
- **Response:** mismo shape que `GET /api/investors/:id` (incluye `updated_at` + `updated_by`).

### 5.2 Semántica por campo

| Cliente envía | Efecto |
|---|---|
| campo ausente | sin cambio |
| campo = "valor nuevo" | se actualiza |
| campo = `null` (solo email/phone/notes) | se borra (NULL en DB) |
| campo = `null` para legal_name/status | 400 (Zod rechaza, no son nullable) |

### 5.3 Matriz de errores

| Code | Cuándo |
|---|---|
| 400 | Zod: clave desconocida (rif, kind, id), body vacío `{}`, value out of range, status fuera de enum |
| 401 | sin JWT |
| 403 | rol sin `investor.update` (auditor) |
| 404 | investor id no existe |
| 409 | intento de cambiar `status` en el inversor interno (kind='internal'). Body: `{ message, kind: 'internal' }` |

Mensajes de negocio en **español**.

---

## 6. Service `update`

```ts
async update(id: string, input: InvestorUpdate, actorId: string) {
  return await this.prisma.$transaction(async (tx) => {
    const existing = await tx.investor.findUnique({
      where: { id },
      include: { updated_by: true },
    });
    if (!existing) throw new NotFoundException('Inversor no encontrado');

    if (
      existing.kind === 'internal' &&
      input.status !== undefined &&
      input.status !== existing.status
    ) {
      throw new ConflictException({
        message: 'El inversor interno no puede cambiar de estado',
        kind: 'internal',
      });
    }

    const editableFields: Array<keyof InvestorUpdate> = [
      'legal_name', 'email', 'phone', 'notes', 'status',
    ];
    const changed: Record<string, { from: unknown; to: unknown }> = {};
    const data: Prisma.InvestorUpdateInput = {};
    for (const k of editableFields) {
      if (!(k in input)) continue;
      const next = input[k] ?? null;
      const prev = existing[k] ?? null;
      if (prev !== next) {
        changed[k] = { from: prev, to: next };
        (data as Record<string, unknown>)[k] = next;
      }
    }

    if (Object.keys(changed).length === 0) {
      return this.assembleSummary(tx, existing);   // no-op: no write, no audit
    }

    const updated = await tx.investor.update({
      where: { id },
      data: { ...data, updated_at: new Date(), updated_by_id: actorId },
      include: { updated_by: true },
    });

    await this.audit.recordChange({
      entityType: 'investor',
      entityId: id,
      action: 'update',
      actorId,
      payload: { changed },
      tx,
    });

    return this.assembleSummary(tx, updated);
  });
}
```

**Audit payload shape (diff format):**

```json
{
  "changed": {
    "email":  { "from": "old@cashea.app", "to": "new@cashea.app" },
    "status": { "from": "active",         "to": "inactive" }
  }
}
```

`from: null` cuando el campo estaba vacío; `to: null` cuando se borra.

**Internal investor edge case:** comparar `input.status !== existing.status` significa que enviar `{ status: 'active' }` a un inversor interno ya activo es un no-op, no un 409. Solo el cambio real dispara el conflict.

---

## 7. Mapper update

`responses/investor-summary.mapper.ts` — agregar `updated_at` (siempre presente) y `updated_by` (objeto user pequeño cuando set):

```ts
export type InvestorSummaryRow = {
  // ...existing fields...
  updated_at: Date;
  updated_by: { id: string; email: string; full_name: string } | null;
};

export function toInvestorSummary(i: InvestorSummaryRow) {
  return {
    // ...existing fields...
    updated_at: i.updated_at.toISOString(),
    updated_by: i.updated_by
      ? { id: i.updated_by.id, email: i.updated_by.email, full_name: i.updated_by.full_name }
      : null,
  };
}
```

`list` y `detail` empiezan a incluir la relación: `include: { updated_by: true }`. Single LEFT JOIN per row — barato.

---

## 8. Observabilidad

- **Audit log:** una fila por cada PATCH exitoso que produjo cambios reales, `entity_type='investor'`, `action='update'`, payload formato diff.
- **No-op (sin cambios reales):** sin audit row, sin write — el endpoint retorna el shape actual con HTTP 200.
- **Pino structured logs:** **deferred** (consistente con Slices 3/4a/4b/4c).

---

## 9. Tests

### 9.1 `investors.service.test.ts` (~6 nuevos)

| # | Scenario |
|---|---|
| 1 | `update` happy: cambia 2 campos; tx.investor.update llamado con esos + updated_at + updated_by_id; audit con diff |
| 2 | `update` no-op: cliente manda valor igual al actual → no write, no audit, retorna shape actual |
| 3 | `update` 404 cuando investor no existe |
| 4 | `update` 409 con `kind: 'internal'` cuando se intenta cambiar status del inversor interno |
| 5 | `update` permite cambiar legal_name + email en inversor interno (solo status bloqueado) |
| 6 | `update` borra campo nullable cuando cliente manda `null` (e.g. `{ email: null }`) |

### 9.2 `investors.controller.test.ts` (~5 nuevos)

| # | Scenario |
|---|---|
| 1 | `PATCH /:id` → 401 sin token |
| 2 | `PATCH /:id` → 403 cuando rol sin `investor.update` (auditor) |
| 3 | `PATCH /:id` → 200 happy |
| 4 | `PATCH /:id` → 400 cuando body vacío (Zod refine) |
| 5 | `PATCH /:id` → 400 cuando body tiene clave desconocida (Zod strict, e.g. `rif`) |

**Total nuevo:** ~11 tests. Total post-4d: 228 + 11 ≈ 239.

### 9.3 Smoke real

1. Aplicar `010_investors_updated_at.sql` en Supabase. Verificar:
   ```sql
   SELECT column_name FROM information_schema.columns
   WHERE table_schema='cfb' AND table_name='investors' AND column_name IN ('updated_at','updated_by_id');
   -- Expected: 2 rows
   ```
2. Bootear `pnpm dev`, mintear JWT del test user (`4bba7f81-443c-47b2-9bec-bc5a502380cc`, role `operator`).
3. Cuerpo del smoke: editar el inversor `Inversora Alpha (smoke)` (creado en Slice 4a, id `7307fa2b-d548-42cf-8bae-3916c32979dd`).
4. **PATCH external:** `{ email: 'alpha-updated@cashea.app', notes: 'Smoke 4d test' }` → **200**, response incluye `updated_at` reciente y `updated_by` con datos del test user.
5. **PATCH body vacío:** `{}` → **400** "Debe enviar al menos un campo a actualizar".
6. **PATCH clave desconocida:** `{ rif: 'J-99999999-9' }` → **400** (Zod strict).
7. **PATCH internal status:** id `9278c875-991c-4472-b2c4-6fd70c512719`, body `{ status: 'inactive' }` → **409** con `kind: 'internal'`.
8. **PATCH internal name:** mismo id, `{ legal_name: 'Grupo Cashea Ve C.A. (test)' }` → **200**.
9. Revertir nombre interno: `{ legal_name: 'Grupo Cashea Ve C.A.' }` → 200.
10. Verificar `audit_log` tiene 3 filas con `entity_type='investor' AND action='update'`, payload con diff.

Stop server.

---

## 10. Acceptance criteria

- [ ] `infra/sql/010_investors_updated_at.sql` aplicada en live Supabase.
- [ ] `PATCH /api/investors/:id` expuesto.
- [ ] `pnpm test` ≈ 239 verde.
- [ ] `pnpm exec tsc --noEmit` clean.
- [ ] `pnpm lint` clean.
- [ ] Smoke real ejecutado: 200 / 400×2 / 409 / 200 verificados; 3 filas de audit_log con diff.
- [ ] `openapi.json` regenerado y commited.
- [ ] `prisma/schema.prisma` actualizado con `updated_at`, `updated_by_id`, named relations.
- [ ] Sin nuevas dependencias.

---

## 11. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Operador olvida aplicar la migración 010 antes del primer PATCH en prod | Acceptance criteria; smoke step 1 verifica column existence; sin migración el endpoint fallaría en TypeScript-time (Prisma client no tendría updated_at) |
| Race entre dos PATCH simultáneos al mismo investor | Last-write-wins por design (Q9); audit log preserva ambas filas con sus diffs |
| Service deja `updated_at` desincronizado con el cambio real (e.g. olvida settearlo) | Service lo setea explícitamente en cada UPDATE; el DEFAULT now() de la columna es safety net |
| Operador intenta cambiar rif / kind y no entiende el 400 | Zod `.strict()` produce mensaje específico "Unrecognized key(s) in object: 'rif'" — claro |
| Internal investor name se cambia accidentalmente | El cambio queda en audit_log con diff; admin puede revertir vía PATCH |
| Frontend cachea `updated_at` y queda stale | Frontend re-fetcha investor después de cualquier mutation; OR vive con stale data por unos segundos — no afecta correctness, solo UX |

---

## 12. Out of scope (para slices siguientes)

- **Slice 5 — Admin:** edición de `cfb.settings` desde UI con audit, gestión de matriz `role_permissions`, dashboard de `audit_log`, vista de "inversores desactivados".
- **Edición de RIF / kind:** fuera de scope. Cambio de RIF requiere KYC re-validation y data migration. Cambio de kind (juridica ⇄ natural) implica re-clasificación legal — caso raro, vía SQL admin.
- **Eliminación de inversores:** intencionalmente fuera de scope. Cashea desactiva, no borra (auditoría / regulatorio).
- **Bulk update:** fuera de scope; el flow es 1-investor-a-la-vez.
- **Notificaciones por email al inversor cuando se editan sus datos:** Slice 5+.
- **Historial visible en la UI:** Slice 5 puede agregar un "Versions" tab que renderiza el audit_log filtrado por entity_type='investor' AND entity_id=:id.
- **Pino structured logs sobre eventos de update:** deferred consistentemente.
