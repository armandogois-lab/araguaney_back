# Slice 4b — Sweep certificates (barrido semanal)

**Estado:** approved · 2026-05-06
**Repos:** `araguaney_back`
**Depende de:** Slice 0 (DB schema con `certificate_type='sweep'`, partial unique `uq_certs_one_sweep_per_cycle`, internal investor seeded), Slice 1 (auth/permissions), Slice 4a (CertificatesService, pricing/payload-hash/iso-week pure libs, IssuanceModule).

---

## 1. Alcance

Slice 4b agrega los **certificados sweep** (barrido semanal): el certificado especial que cada viernes envuelve todo el remanente de órdenes `available` que aún cumplen el maturity boundary. Lo compra Cashea misma a través del inversor `kind='internal'` ya seedeado.

Entrega 2 endpoints (`POST /api/certificates/sweep/simulate` y `POST /api/certificates/sweep`), una migración SQL pequeña que agrega el permiso `certificate.sweep`, y reutiliza al máximo la infraestructura de Slice 4a (pricing, payload-hash, audit, FOR UPDATE pattern).

**Excluye:** cancel (Slice 4c), edición de inversores (Slice 4d+), edición del `default_sweep_rate` desde admin UI (Slice 5).

---

## 2. Decisiones tomadas (no re-discutir)

| # | Decisión | Justificación |
|---|---|---|
| 1 | `term_days` lo elige el operador entre 14 y 42 | Match con producto: el operador decide a qué plazo se barre |
| 2 | `rate` viene de `cfb.settings.default_sweep_rate` (8%), operador puede overridear | Flexibilidad sin obligar a teclear lo de siempre |
| 3 | `issue_date` lo elige el operador; warning soft si no es viernes | Cubre feriados y excepciones, audit-friendly |
| 4 | Pool eligibility = `status='available' AND max_due_date <= maturity_date` | Mantiene la regla dura de maturity boundary |
| 5 | **El pool absorbe TODA orden elegible** — sin saltar ninguna | Invariante semántica: "barrido" = todo lo restante |
| 6 | Endpoints dedicados `/api/certificates/sweep/...` | Inputs y semántica fundamentalmente distintos a standard |
| 7 | Permiso nuevo `certificate.sweep`, granted a operator + admin | Granularidad para revocar sweep sin tocar issuance estándar |
| 8 | Wizard de 2 pasos (simulate → issue) con `expected_payload_hash` | Race protection contra ingestión concurrente entre clicks |
| 9 | `nominal_target = nominal_actual` (sweep no tiene shortfall por construcción) | Capital es derivado, no input — el shortfall=0 es la verdad |
| 10 | Pool vacío → 422 sin sweep $0 | El CHECK `investor_capital > 0` lo prohíbe; un sweep vacío sería ruido |

---

## 3. Arquitectura

```
src/modules/issuance/
  sweep/                                       NUEVO
    sweep.controller.ts                        2 endpoints
    sweep.controller.test.ts                   ~6 supertest
    sweep.service.ts                           simulateSweep + issueSweep
    sweep.service.test.ts                      ~10 unit tests
    sweep.dto.ts                               Zod schemas
    responses/
      sweep-simulation-result.mapper.ts        reusa shape de standard + warnings[]
  certificates/                                SIN CAMBIOS — Slice 4a
  investors/                                   SIN CAMBIOS — Slice 4a
  issuance.module.ts                           MODIFICAR — registrar SweepController + SweepService

infra/sql/
  007_sweep_permission.sql                     NUEVO — adds certificate.sweep + grants
```

`SweepService` reutiliza `computePricing`, `computePayloadHash` (vía `buildHashPayload` de Slice 4a, idéntico shape de inputs), `isoWeek`, `AuditService`, y el patrón `prisma.$transaction({ timeout: 30_000 })` con `SELECT ... FOR UPDATE` raw SQL. **No usa `fillPool`** — ese helper existe para el caso greedy capital-bounded; sweep no tiene cap.

El internal investor se busca server-side cada vez via `prisma.investor.findFirst({ where: { kind: 'internal' } })` (la base lo seedeó como `9278c875-991c-4472-b2c4-6fd70c512719`, "Grupo Cashea Ve C.A.", RIF `J-50154179-5`). El partial unique index `uq_investors_one_internal` garantiza que solo hay uno.

El `next_certificate_code()` de Postgres se reutiliza tal cual: sweeps comparten secuencia con los standard. Si Cashea emite C4572A, C4573A, C4574A (estándar) durante la semana, el sweep del viernes será C4575A.

---

## 4. Endpoints

### 4.1 `POST /api/certificates/sweep/simulate` — preview

- **Permission:** `certificate.sweep`
- **HTTP:** 200
- **Body (Zod):**

```ts
{
  term_days: z.union([z.literal(14), z.literal(42)]),
  issue_date: z.coerce.date().refine(d => d >= startOfTodayUTC()),  // mismo refine que standard
  rate: z.coerce.number().min(0).max(0.999999).optional(),
}
```

- **Response:** ver `sweep-simulation-result.mapper.ts` — incluye `inputs`, `pricing`, `pool`, `payouts`, `concentration`, `due_date_distribution`, `payload_hash`, y un campo opcional `warnings: ['not_friday']` cuando `issue_date.getUTCDay() !== 5`.
- **Inputs.investor:** SIEMPRE el internal investor (no entra del cliente).
- **Inputs.rate_source:** `'settings_default' | 'override'` para que la UI muestre la fuente.

### 4.2 `POST /api/certificates/sweep` — emisión transaccional

- **Permission:** `certificate.sweep`
- **HTTP:** 201
- **Body (Zod):** `term_days`, `issue_date`, `rate?` (mismos que simulate) + `order_ids: z.array(uuid).min(1).max(2000)` + `expected_payload_hash: regex /^[a-f0-9]{64}$/`.
- **Response:** `{ id: uuid, certificate_code: 'C{NNNN}{LETRA}' }`.

### 4.3 Matriz de errores

| Código | Cuándo |
|---|---|
| 400 | rate fuera de rango, internal investor missing, internal investor inactive |
| 401 | sin JWT |
| 403 | rol sin `certificate.sweep` |
| 409 | una orden de `order_ids` ya no está `available` (race con standard issue), O `uq_certs_one_sweep_per_cycle` ya tiene un sweep para `cycle_week` (race entre dos sweeps simultáneos) |
| 422 | pool vacío, `payload_hash` no matchea, pool actual ≠ claimed (orden ingresada entre simulate e issue), MAX(`max_due_date`) > maturity |

Mensajes de negocio en **español** (capa de aplicación). Errores de auth (401/403) en inglés (per memory `feedback_auth_messages_english.md`).

---

## 5. Pool selection y matemática

### 5.1 Selección del pool (sweep-specific)

Misma query que standard:

```ts
const eligible = await prisma.order.findMany({
  where: { status: 'available', max_due_date: { lte: maturityDate } },
  select: { id, external_order_id, installments_sum, merchant_id, num_installments, max_due_date, purchase_date },
});
```

Sort determinista (sin filtrar; **todo entra**):

```ts
const selected = [...eligible].sort((a, b) => {
  const cmp = b.installments_sum.comparedTo(a.installments_sum);
  return cmp !== 0 ? cmp : a.external_order_id.localeCompare(b.external_order_id);
});

if (selected.length === 0) {
  throw new UnprocessableEntityException('No hay stock disponible para barrido');
}
```

El sort vive **inline en `SweepService`** — son 4 líneas, no amerita helper file.

### 5.2 Math

```ts
const nominalActual    = sum(selected.installments_sum);                  // Decimal(18,4)
const rate             = new Decimal(input.rate ?? settings.default_sweep_rate);
const { price }        = computePricing({ capital: nominalActual, rate, termDays }); // reuso, descartamos su nominalTarget
const investorCapital  = nominalActual.mul(price).toDecimalPlaces(4, ROUND_HALF_UP);
const nominalTarget    = nominalActual;     // sweep invariant: target == actual
const investorPaid     = investorCapital;
const investorReturned = new Decimal(0);
const investorYield    = nominalActual.minus(investorCapital);
const shortfallPct     = new Decimal(0);
```

Todos los CHECK constraints del schema se satisfacen trivialmente (`nominal_actual <= nominal_target`, capital identity, yield identity, `price ∈ (0, 1]`, `investor_capital > 0`, `term_days IN (14, 42)`).

### 5.3 `payload_hash`

Reutiliza `computePayloadHash` y `buildSweepHashPayload` (helper paralelo a `buildHashPayload` de Slice 4a). El shape de inputs es **idéntico** al de standard: `{ capital, rate, term_days, issue_date, investor_id }` (donde `investor_id` es el internal y `capital` es el derivado), `outputs` igual al de standard, `order_ids[sorted]`. Cualquier herramienta de auditoría que procese hashes funciona indistinto entre standard y sweep.

---

## 6. `issueSweep` transaccional

`prisma.$transaction(async (tx) => { ... }, { timeout: 30_000 })`:

1. **Cargar internal investor** (`tx.investor.findFirst({ where: { kind: 'internal' } })`); 400 si missing/inactive.
2. **Validar inputs** y derivar `price`, `maturityDate`.
3. **Lock orders** vía raw SQL `SELECT ... WHERE id = ANY(${order_ids}::uuid[]) FOR UPDATE`.
4. **Validar count** (409 missing), **status all available** (409 conflicting), **MAX max_due_date** (422 maturity).
5. **Re-fetch eligible set actual** (mismo where que simulate) DENTRO del tx, comparar como sets contra `input.order_ids`. Mismatch → 422 "Pool inválido — re-corra /simulate". Esto cierra la ventana entre simulate e issue por nueva ingestión.
6. **Recompute math** (sort + sum + price + capital + payouts).
7. **Recompute `payload_hash`**, comparar contra `expected_payload_hash`. Mismatch → 422 "Payload mismatch".
8. **`SELECT cfb.next_certificate_code()`** vía raw SQL.
9. **INSERT certificate** con `certificate_type: 'sweep'`, `investor_id: <internal>`, todos los campos derivados, `cycle_week: isoWeek(issue_date)`.
10. **INSERT certificate_orders.createMany** con `installments_sum_snapshot`.
11. **UPDATE orders** SET `status='assigned'` para los `selected.id`.
12. **INSERT certificate_events** con `event_type: 'created'`, payload con `certificate_type: 'sweep'`, `order_count`, `nominal_actual`, `investor_capital`.
13. **`audit.recordChange`** con `entity_type: 'certificate'` (consistente con standard), payload incluyendo `certificate_type: 'sweep'`, `cycle_week`, `payload_hash`. Pasamos `tx` para atomicidad.
14. **Try/catch Prisma `P2002`** sobre `uq_certs_one_sweep_per_cycle` → traducir a `ConflictException({ message: 'Ya existe un sweep para esta semana', cycle_week })`.

**Diferencias vs standard `issue`:**
- Sin `investor_id` del cliente.
- Sin `capital` del cliente.
- Step 5 (re-fetch eligible) es nuevo — defensa contra ingestión concurrente que silenciosamente dejaría órdenes fuera del barrido.
- Step 14 cacha el conflict del partial unique index.

---

## 7. SQL migration

`infra/sql/007_sweep_permission.sql`:

```sql
-- 007_sweep_permission.sql
-- Adds the certificate.sweep permission and grants it to operator + admin.
-- Idempotent — safe to re-run.
-- Depends on: 005_authz.sql (cfb.permissions, cfb.role_permissions, cfb.role enum).

BEGIN;

INSERT INTO cfb.permissions (key, description) VALUES
  ('certificate.sweep', 'Emitir certificado sweep semanal (barrido del remanente)')
ON CONFLICT (key) DO NOTHING;

INSERT INTO cfb.role_permissions (role, permission_id)
SELECT v.role::cfb.role, p.id
FROM (VALUES
  ('operator', 'certificate.sweep'),
  ('admin',    'certificate.sweep')
) AS v(role, key)
JOIN cfb.permissions p ON p.key = v.key
ON CONFLICT (role, permission_id) DO NOTHING;

COMMIT;
```

Aplicar manualmente desde Supabase SQL Editor antes de bootear el backend en prod. No requiere cambios en `prisma/schema.prisma` (las tablas `permissions` y `role_permissions` ya existen desde Slice 1).

---

## 8. Observabilidad

- **Audit log:** una fila por cada `issueSweep` exitoso, `entity_type='certificate'`, `action='create'`, payload con `certificate_type='sweep'`, `cycle_week`, `order_count`, `payload_hash`.
- **certificate_events:** un evento `created` por cert (inmutable, igual que standard).
- **Pino logs estructurados:** **deferred** a un slice futuro (consistente con políticas de Slices 3 y 4a).

---

## 9. Tests

### 9.1 `sweep.service.test.ts` (~10)

| # | Scenario |
|---|---|
| 1 | `simulateSweep` happy: derives capital, target=actual, shortfall=0, payload_hash format |
| 2 | `simulateSweep` 422 cuando no hay órdenes elegibles |
| 3 | `simulateSweep` agrega `warnings: ['not_friday']` cuando `issue_date.getUTCDay() !== 5` |
| 4 | `simulateSweep` usa `settings.default_sweep_rate` cuando `rate` se omite |
| 5 | `simulateSweep` honra el override de `rate` |
| 6 | `simulateSweep` produce `payload_hash` determinista entre dos calls |
| 7 | `simulateSweep` 400 cuando no existe internal investor |
| 8 | `issueSweep` happy: lock + insert cert sweep + commit |
| 9 | `issueSweep` 422 cuando locked set ≠ current eligible set (defensa-en-profundidad) |
| 10 | `issueSweep` 409 con `cycle_week` cuando Prisma P2002 dispara (sweep ya esta semana) |

### 9.2 `sweep.controller.test.ts` (~6)

| # | Scenario |
|---|---|
| 1 | `POST /sweep/simulate` → 401 sin token |
| 2 | `POST /sweep/simulate` → 403 cuando rol no tiene `certificate.sweep` |
| 3 | `POST /sweep/simulate` → 200 happy |
| 4 | `POST /sweep` → 401 sin token |
| 5 | `POST /sweep` → 201 happy |
| 6 | `POST /sweep` → 409 cuando service tira ConflictException (P2002 traducido) |

**Total nuevo: ~16 tests.** Total post-4b: 200 (Slices 0–4a) + 16 ≈ 216.

### 9.3 Smoke real

1. Aplicar `007_sweep_permission.sql` en Supabase SQL Editor.
2. Insertar (vía MCP o seed) ~2 órdenes test en `status='available'` con `max_due_date` dentro del término elegido. Las del Slice 2 (`ORD-SMOKE-1`/`-2`) ya están `assigned` a `C4572A`, así que esto es necesario.
3. Bootear `pnpm dev`, mintear JWT para el test user existente (`4bba7f81-443c-47b2-9bec-bc5a502380cc`).
4. `POST /api/certificates/sweep/simulate` con `term_days=14, issue_date=2026-05-15` (viernes) → 200, ver pool con todas las órdenes test, derived capital, sin `warnings` (es viernes — el warning `not_friday` se cubre en unit test #3, no en smoke).
5. `POST /api/certificates/sweep` con los `order_ids` y `payload_hash` del simulate → 201, sweep emitido (e.g. `C4575A`).
6. Re-emitir mismo body → 409 con `cycle_week='2026-W20'`.
7. Verificar en Supabase MCP: `SELECT count(*) FROM cfb.certificates WHERE certificate_type='sweep' AND cycle_week='2026-W20'` → 1, y `SELECT count(*) FROM cfb.orders WHERE status='assigned'` aumentó por la cantidad de órdenes test seedeadas.

---

## 10. Acceptance criteria

- [ ] `infra/sql/007_sweep_permission.sql` aplicada en live Supabase.
- [ ] 2 endpoints expuestos: `POST /api/certificates/sweep/simulate`, `POST /api/certificates/sweep`.
- [ ] `pnpm test` ≈ 216 verde.
- [ ] `pnpm exec tsc --noEmit` clean.
- [ ] `pnpm lint` clean.
- [ ] Smoke real ejecutado: 200 / 201 / 409 / DB verifications OK.
- [ ] `openapi.json` regenerado con los 2 paths nuevos y commited.
- [ ] Sin nuevas dependencias. Sin cambios al `schema.prisma` (solo SQL migration).

---

## 11. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Operador olvida ejecutar la migración 007 antes del primer sweep en prod | Acceptance criteria lo lista; smoke step 1 lo verifica |
| Race entre dos sweeps simultáneos | Partial unique `uq_certs_one_sweep_per_cycle` + try/catch P2002 → 409 explícito |
| Race entre standard issue y sweep simultáneos sobre mismas órdenes | `SELECT FOR UPDATE` serializa; el segundo ve `status='assigned'` y aborta con 409 conflicting_order_ids |
| Ingestión nueva entre simulate y issue de sweep deja órdenes fuera | Step 5 del tx (re-fetch eligible y comparar contra claimed) → 422 explícito; el `payload_hash` también lo cubre |
| Internal investor borrado o desactivado por error | 400 con mensaje claro; partial unique index protege contra duplicados al re-crearlo |
| Operador override `rate` con valor irracional (e.g. 0.99) | Zod `max(0.999999)` + price CHECK > 0; sin protección de "razonabilidad de mercado" — fuera de scope, audit log lo deja registrado |

---

## 12. Out of scope (para slices siguientes)

- **Slice 4c — Cancel:** soft-delete de certificates con razón, liberar órdenes a `status='available'` de nuevo, evento `cancelled`, audit. Aplica también a sweeps.
- **Slice 4d — Investor update:** PATCH `/api/investors/:id` para legal_name/email/phone/notes/status (NO RIF, NO kind).
- **Slice 5 — Admin:** edición de `cfb.settings.default_sweep_rate` desde UI con audit, gestión de la matriz role_permissions, dashboard del audit_log.
- **Pino structured logs sobre eventos de issuance/sweep:** deferred consistentemente con políticas de Slice 3 y 4a.
- **Sweep cron automatizado** (los viernes a las HH:MM): fuera de scope; el operador siempre clickea el botón. Si en el futuro se automatiza, la API ya soporta el flow programático.
