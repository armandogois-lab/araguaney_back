# Slice 4a — Emisión (core): diseño

**Fecha**: 2026-05-06
**Autor**: armandogois@cashea.app + Claude (brainstorming)
**Estado**: en revisión
**Próximo paso**: tras aprobación, invocar writing-plans
**Depende de**: Slice 0 (Foundation), Slice 1 (Auth), Slice 2 (Ingestión), Slice 3 (Cartera) — todos en `main`.

---

## 1. Objetivo

Construir el corazón del producto Cashea CFB: el flujo de emisión de certificados de financiamiento bursátil para inversores externos. El operador (Tesorería) selecciona un inversor, define los parámetros financieros (capital, tasa, plazo, fecha), el sistema **automáticamente** elige las órdenes elegibles que maximizan el llenado del nominal target sin pasarse, y emite el certificado en una transacción atómica que blindajea las 3 reglas duras.

El alcance "4a" excluye sweep certificates (4b), cancel (4c), y admin avanzado (4d+). Cubre: 7 endpoints (3 investors + 4 certificates) + algoritmo greedy + cálculos pricing + simulación + emisión real + lectura.

### Por qué importa

- Es el flujo donde el dinero del inversor se convierte en CFB. Sin esto, el sistema no genera valor.
- Las 3 reglas duras de CLAUDE.md (maturity boundary, order indivisibility, round-down) deben blindarse en este slice — la app y la DB las enforce, los tests las garantizan.
- Cierra el ciclo desde la ingestión (Slice 2) → query/preview (Slice 3) → emisión real (Slice 4) que el frontend necesita para mostrar el wizard de 3 pasos visto en el screenshot del usuario.

### Fuera de alcance

- **Sweep certificates** (viernes, internal Cashea investor, partial unique uq_certs_one_sweep_per_cycle) — Slice 4b.
- **Cancelación / soft-delete** de certificados (`certificate.cancel` permission) — Slice 4c.
- **Update** de campos no-financieros del certificado (`certificate.update`) — Slice 4d.
- **Investor update / deactivate** — Slice 5+.
- **Auto-selección con heurísticas alternativas** (best-fit, smallest-first) — YAGNI hasta que el operador pida.
- **Idempotency-Key header** — Slice futuro si surge race del frontend.
- **Listado de certs deleted** (`certificate.read_deleted`) — irrelevante hasta Slice 4c.

---

## 2. Decisiones tomadas

1. **Algoritmo greedy descending** por `installments_sum`, tie-break por `external_order_id` ASC. Determinístico. Declarado en el screenshot del producto: *"greedy descendente · base Actual/360 · redondeo hacia abajo"*.
2. **Round-down only**: `nominal_actual <= nominal_target` siempre. Si no se llena exacto, `investor_returned` (cash refund) absorbe el residual.
3. **Selección 100% automática** desde el server. El frontend NO muestra ni envía `order_ids` para simular; los recibe del simulate y los reenvía al issue como ack.
4. **Simulate stateless**: no escribe a DB, retorna preview completo + `payload_hash` para que el issue sucesivo verifique consistencia.
5. **Issue defensivo**: re-fetcha eligible orders con `FOR UPDATE`, recomputa el pool, valida que matchee `order_ids` enviados por el cliente, valida `payload_hash` contra recomputado. Cualquier divergencia → 409/422.
6. **Investor pre-existente o creado en mismo flow**: el slice incluye `GET /api/investors`, `GET /api/investors/:id`, `POST /api/investors` (sin update por ahora — YAGNI). El RIF se normaliza con el helper de Slice 2.
7. **`payload_hash` = sha256(JSON canónico)** sobre `{ inputs: {capital, rate, term_days, issue_date, investor_id}, outputs: {price, nominal_target, nominal_actual, investor_paid, investor_returned, investor_yield, shortfall_pct}, order_ids: [sorted asc] }`. Tamper-evidence de la emisión.
8. **`certificate_code` por DB**: `cfb.next_certificate_code()` (función Postgres existente desde Slice 0) garantiza unicidad y secuencia continua desde C4572A.
9. **`cycle_week`** = ISO 8601 week of `issue_date`, formato `YYYY-WNN`. Auto-computado server-side.
10. **Decimal arithmetic con `Prisma.Decimal`** en todo el pipeline. `.toFixed(N)` solo en serialización final. HALF_UP rounding por default; round DOWN solo donde el algoritmo lo exige (greedy `<=`).
11. **Mensajes de error en español** para auth excepto sí (auth-layer en inglés per memoria).
12. **Sin nuevas dependencias, sin nuevas migraciones SQL.** Toda la estructura ya está en Slice 0.

---

## 3. Arquitectura

```
src/modules/issuance/
  issuance.module.ts                          ← agrupa 2 sub-controllers (investors, certificates)
  investors/
    investors.controller.ts                   ← GET list, GET :id, POST
    investors.service.ts
    investors.service.test.ts                 ← 6 tests
    investors.controller.test.ts              ← 7 tests
    investors.dto.ts                          ← Zod (list query, CreateInvestorSchema)
    responses/
      investor-summary.mapper.ts              ← row → API list shape
      investor-detail.mapper.ts
  certificates/
    certificates.controller.ts                ← POST simulate, POST issue, GET list, GET :id
    certificates.service.ts                   ← orquesta simulate + issue + read
    certificates.service.test.ts              ← 17 tests
    certificates.controller.test.ts           ← 9 tests
    certificates.dto.ts                       ← Zod (SimulateSchema, IssueSchema, list query)
    responses/
      certificate-summary.mapper.ts
      certificate-detail.mapper.ts
      simulation-result.mapper.ts
    pricing/
      pricing.ts                              ← funciones puras: computePricing, computePayouts
      pricing.test.ts                         ← 7 tests
    pool-builder/
      pool-builder.ts                         ← greedy descending (función pura)
      pool-builder.test.ts                    ← 8 tests
    payload-hash/
      payload-hash.ts                         ← canonical JSON + sha256
      payload-hash.test.ts                    ← 4 tests
    helpers/
      iso-week.ts                             ← ISO 8601 week computation
      iso-week.test.ts                        ← 4 tests

src/app.module.ts                             ← MODIFY: import IssuanceModule

openapi.json                                  REGENERATE + COMMIT
```

**Principios**:
- **Funciones puras separadas en archivos chicos** (`pricing.ts`, `pool-builder.ts`, `payload-hash.ts`, `iso-week.ts`). Cada una unit-testeable sin DB ni Prisma. Reutilizables para Slice 4b (sweep).
- **`CertificatesService.simulate`** stateless: query Prisma → función pura → query Prisma para concentración → mapper. Sin escritura.
- **`CertificatesService.issue`** todo en `prisma.$transaction({ timeout: 30_000 })`:
  1. Lock orders con `FOR UPDATE`.
  2. Recompute pool y payload_hash; comparar con cliente.
  3. Insert certificate row con `next_certificate_code()`.
  4. Insert certificate_orders rows (rules 1+2 blindajes en DB se disparan).
  5. Update orders status='assigned' (trigger graba events).
  6. Insert certificate_event 'created'.
  7. AuditService.recordChange.
- **`AuditService`** ya existe (Slice 3) y se inyecta automáticamente vía `@Global()`.
- **Permisos**: `certificate.simulate`, `certificate.issue`, `certificate.read`, `investor.read`, `investor.create`. Todos seedeados en Slice 0.

---

## 4. Algoritmo + pricing (funciones puras)

### 4.1 — Pricing

```ts
import { Prisma } from '@prisma/client';
const D = Prisma.Decimal;

export type PricingInputs = {
  capital: Prisma.Decimal;          // numeric(18,4)
  rate: Prisma.Decimal;             // 0 ≤ rate < 1 (DB CHECK)
  termDays: 14 | 42;
};

export function computePricing(i: PricingInputs) {
  const ratio = i.rate.mul(i.termDays).div(360);
  const price = new D(1).minus(ratio).toDecimalPlaces(6, D.ROUND_HALF_UP);
  const nominalTarget = i.capital.div(price).toDecimalPlaces(4, D.ROUND_HALF_UP);
  return { price, nominalTarget };
}

export function computePayouts(opts: {
  capital: Prisma.Decimal;
  price: Prisma.Decimal;
  nominalTarget: Prisma.Decimal;
  nominalActual: Prisma.Decimal;
}) {
  const investorPaid = opts.nominalActual.mul(opts.price).toDecimalPlaces(4, D.ROUND_HALF_UP);
  const investorReturned = opts.capital.minus(investorPaid);
  const investorYield = opts.nominalActual.minus(investorPaid);
  const shortfallPct = opts.nominalTarget.isZero()
    ? new D(0)
    : opts.nominalTarget.minus(opts.nominalActual).div(opts.nominalTarget)
        .toDecimalPlaces(6, D.ROUND_HALF_UP);
  return { investorPaid, investorReturned, investorYield, shortfallPct };
}
```

### 4.2 — Pool builder (greedy descending)

```ts
export type EligibleOrder = {
  id: string;
  external_order_id: string;
  installments_sum: Prisma.Decimal;
  merchant_id: string;
  num_installments: number;
  max_due_date: Date;
};

export function fillPool(eligible: EligibleOrder[], target: Prisma.Decimal) {
  const sorted = [...eligible].sort((a, b) => {
    const cmp = b.installments_sum.comparedTo(a.installments_sum);
    if (cmp !== 0) return cmp;
    return a.external_order_id.localeCompare(b.external_order_id);
  });
  const selected: EligibleOrder[] = [];
  let nominalActual = new Prisma.Decimal(0);
  for (const o of sorted) {
    const tentative = nominalActual.plus(o.installments_sum);
    if (tentative.lessThanOrEqualTo(target)) {
      selected.push(o);
      nominalActual = tentative;
    }
  }
  return { selected, nominalActual };
}
```

**Determinismo**: misma `eligible[]` + mismo `target` → mismo `selected[]` siempre. Crítico para reproducibilidad y `payload_hash` consistencia.

**Complejidad**: O(n log n). Para 343 órdenes (caso del screenshot), <1ms.

### 4.3 — Edge cases del algoritmo

| Caso | Comportamiento |
|---|---|
| Eligible vacío | `selected=[]`, `nominalActual=0`. Service rechaza con 422 antes de seguir. |
| Una sola orden > target | Skip. Sigue. Si nadie fitea → 422. |
| Capital tan chico que `target=0` | 422. |
| Todas las orders fitean | `nominalActual = SUM(eligible.installments_sum)`, posiblemente < target → shortfall positivo. OK. |
| Empate de `installments_sum` | Tie-break por `external_order_id` ASC → determinístico. |

### 4.4 — Payload hash

```ts
import { createHash } from 'node:crypto';

export type PayloadHashInput = {
  inputs: { capital: string; rate: string; term_days: 14 | 42; issue_date: string; investor_id: string };
  outputs: { price: string; nominal_target: string; nominal_actual: string;
             investor_paid: string; investor_returned: string; investor_yield: string; shortfall_pct: string };
  order_ids: string[];
};

export function computePayloadHash(p: PayloadHashInput): string {
  const canonical = JSON.stringify({
    inputs: sortKeys(p.inputs),
    outputs: sortKeys(p.outputs),
    order_ids: [...p.order_ids].sort(),
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function sortKeys<T extends Record<string, unknown>>(obj: T): T {
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) sorted[k] = obj[k];
  return sorted as T;
}
```

Decimales serializados como string vía `.toFixed(N)` antes de pasar al hash, para que el JSON canónico sea estable.

### 4.5 — ISO week helper

```ts
export function isoWeek(d: Date): string {
  // ISO 8601: weeks start Monday; week 1 contains the year's first Thursday.
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;        // Mon=0..Sun=6
  target.setUTCDate(target.getUTCDate() - dayNum + 3); // Thursday of this week
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstThursdayDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDayNum + 3);
  const weekNum = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86400 * 1000));
  return `${target.getUTCFullYear()}-W${weekNum.toString().padStart(2, '0')}`;
}
```

Tests cubren: 2026-04-27 → "2026-W18", boundary fin de año (semana 53), boundary inicio de año (puede ser W52 del año previo), año bisiesto.

---

## 5. Endpoints — Investors

### `GET /api/investors`

Auth: `@RequirePermission('investor.read')`.

**Query** (`investors.dto.ts`):
```ts
PaginationSchema.extend({
  q: z.string().min(1).max(100).optional(),
  kind: z.enum(['juridica', 'natural', 'internal']).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  sort: z.enum(['name_asc', 'name_desc', 'created_desc']).default('name_asc'),
})
```

**Response**:
```jsonc
{
  "data": [{
    "id": "uuid", "legal_name": "Inversora Alpha, C.A.", "rif": "J-12345678-9",
    "kind": "juridica", "status": "active",
    "email": null, "phone": null, "notes": null,
    "created_at": "2026-04-15T10:00:00.000Z",
    "active_cert_count": 2, "total_invested": "285000.0000"
  }],
  "total": 5, "limit": 50, "offset": 0
}
```

`active_cert_count` = COUNT de `certificates WHERE investor_id = ? AND status IN ('issued','matured') AND deleted_at IS NULL`. `total_invested` = SUM de `investor_capital` de esas filas.

### `GET /api/investors/:id`

Auth: `@RequirePermission('investor.read')`. Mismo shape que el item de list. `404` si no existe.

### `POST /api/investors`

Auth: `@RequirePermission('investor.create')`.

**Body**:
```ts
z.object({
  legal_name: z.string().min(1).max(255),
  rif: z.string().min(1).max(50),
  kind: z.enum(['juridica', 'natural']),     // internal NO permitido por API
  email: z.string().email().max(255).nullable().optional(),
  phone: z.string().min(1).max(50).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
})
```

**Lógica**:
1. Normalizar RIF con `normalizeRif()` (helper Slice 2). Si null → 400 `"RIF inválido"`.
2. Buscar collision en `investors.rif` (UNIQUE). Si existe → 409 `"Inversor con ese RIF ya existe"` con `existing_id`.
3. Insert con `status='active'`, `created_by_id = req.user.id`.
4. `AuditService.recordChange(entityType='investor', action='create', payload={...input})`.
5. `201 Created` con shape de detail (`active_cert_count: 0, total_invested: "0.0000"`).

---

## 6. Endpoints — Certificates

### `POST /api/certificates/simulate`

Auth: `@RequirePermission('certificate.simulate')`.

**Body**:
```ts
z.object({
  investor_id: z.string().uuid(),
  capital: z.coerce.number().positive(),
  rate: z.coerce.number().min(0).max(0.999999),
  term_days: z.union([z.literal(14), z.literal(42)]),
  issue_date: z.coerce.date(),
}).refine(
  (d) => d.issue_date.getTime() >= startOfTodayUTC().getTime(),
  { message: 'La fecha de emisión no puede ser anterior a hoy' },
)
```

**Lógica**:
1. Lookup investor. 404 si no existe. 400 si `kind='internal'` o `status='inactive'`.
2. `computePricing` → price, nominal_target.
3. `maturity_date = issue_date + term_days días`.
4. Fetch eligible orders desde Prisma con el index `idx_orders_eligibility`.
5. `fillPool(eligible, nominal_target)` → selected, nominal_actual.
6. Si `selected.length === 0` → 422.
7. `computePayouts` → investor_paid, returned, yield, shortfall_pct.
8. Compute aggregates: distinct merchants, cuota plazos min/max, top-5 concentration con %, due-date distribution buckets.
9. `computePayloadHash` con todos los valores.
10. Retornar todo.

**Response** (`200 OK`):
```jsonc
{
  "rules_check": { "maturity_boundary": true, "order_indivisibility": true, "round_down": true },
  "inputs": {
    "investor_id": "uuid",
    "investor": { "id": "uuid", "legal_name": "Inversora Alpha, C.A.", "rif": "J-12345678-9" },
    "capital": "100000.0000", "rate": "0.130000", "term_days": 42,
    "issue_date": "2026-04-27", "maturity_date": "2026-06-08"
  },
  "pricing": { "price": "0.984833", "nominal_target": "101540.6028" },
  "pool": {
    "order_ids": ["uuid-1", "uuid-2"],
    "order_count": 343, "merchant_count": 71, "installment_count": 889,
    "installment_plazo_days": { "min": 7, "max": 42 }
  },
  "payouts": {
    "nominal_actual": "101540.0034", "investor_paid": "99999.4083",
    "investor_returned": "0.5917", "investor_yield": "1540.5951",
    "shortfall_pct": "0.000006"
  },
  "concentration": {
    "top": [
      { "merchant_id": "uuid", "current_name": "Central Madeirense, C.A.", "rif": "J-...", "amount": "17478.0000", "pct": "0.172145" }
    ],
    "total_distinct_merchants": 71
  },
  "due_date_distribution": [
    { "date": "2026-05-04", "amount": "32180.0000" }
  ],
  "payload_hash": "sha256-hex-64-chars"
}
```

### `POST /api/certificates`

Auth: `@RequirePermission('certificate.issue')`.

**Body**:
```ts
z.object({
  investor_id: z.string().uuid(),
  capital: z.coerce.number().positive(),
  rate: z.coerce.number().min(0).max(0.999999),
  term_days: z.union([z.literal(14), z.literal(42)]),
  issue_date: z.coerce.date(),
  order_ids: z.array(z.string().uuid()).min(1).max(2000),
  expected_payload_hash: z.string().regex(/^[a-f0-9]{64}$/),
})
```

**Lógica** (todo en `prisma.$transaction({ timeout: 30_000 })`):
1. Validaciones iguales a simulate (investor existe, kind != internal, active).
2. `computePricing`.
3. **Lock orders**: raw SQL `SELECT id, installments_sum, max_due_date, merchant_id, status FROM cfb.orders WHERE id = ANY($1::uuid[]) FOR UPDATE`. Si rows < `order_ids.length` → 409 `"Una o más órdenes no existen"`. Si alguna `status != 'available'` → 409 `"Orden(es) ya asignada(s) a otro certificado"` con `conflicting_order_ids[]`.
4. Verificar rule 1: `MAX(max_due_date) <= maturity_date`. Si no → 422 (defensa, no debería pasar si simulate hizo su trabajo).
5. Recompute `fillPool([orders fetched], nominal_target)`. Verificar que `selected` matchea `order_ids` exactamente. Si difiere → 422 `"Pool inválido — re-corra /simulate"`.
6. `computePayouts`.
7. `computePayloadHash`. Si != `expected_payload_hash` → 422 `"Payload mismatch — re-corra /simulate"`.
8. `cycle_week = isoWeek(issue_date)`.
9. INSERT `certificates`:
   - `certificate_code = (SELECT cfb.next_certificate_code())` (raw SQL en mismo tx)
   - `certificate_type = 'standard'`, `status = 'issued'`
   - todos los campos computados, `payload_hash`
   - `issued_by_id = req.user.id`
10. INSERT `certificate_orders` (uno por order_id) con `installments_sum_snapshot` desde la orden lockeada y `assigned_by_id = req.user.id`.
11. UPDATE `orders SET status='assigned'` WHERE id IN (...). Trigger `trg_orders_status_log` graba `order_events` automáticamente.
12. INSERT `certificate_events`: `event_type='created', payload={ inputs, outputs, order_count }, actor_id`.
13. `AuditService.recordChange(entityType='certificate', action='create', payload, tx)`.
14. COMMIT.

**Response** (`201 Created`): mismo shape que `GET /api/certificates/:id`.

### `GET /api/certificates`

Auth: `@RequirePermission('certificate.read')`.

**Query**:
```ts
PaginationSchema.extend({
  status: z.enum(['draft','issued','matured','cancelled']).optional(),
  certificate_type: z.enum(['standard','sweep']).optional(),
  investor_id: z.string().uuid().optional(),
  issue_date_from: z.coerce.date().optional(),
  issue_date_to: z.coerce.date().optional(),
  q: z.string().min(1).max(100).optional(),       // substring sobre certificate_code
  sort: z.enum(['issue_date_desc','issue_date_asc','code_asc']).default('issue_date_desc'),
})
```

**Response**: paginated summary list. Filtra `WHERE deleted_at IS NULL` automático.

```jsonc
{
  "data": [{
    "id": "uuid", "certificate_code": "C4572A",
    "certificate_type": "standard", "status": "issued",
    "investor": { "id": "uuid", "legal_name": "...", "rif": "..." },
    "investor_capital": "100000.0000", "annual_rate": "0.130000", "term_days": 42,
    "price": "0.984833", "nominal_target": "101540.6028", "nominal_actual": "101540.0034",
    "investor_paid": "99999.4083", "investor_yield": "1540.5951", "shortfall_pct": "0.000006",
    "issue_date": "2026-04-27", "maturity_date": "2026-06-08", "cycle_week": "2026-W18",
    "issued_by": { "id": "uuid", "email": "...", "full_name": "..." },
    "created_at": "..."
  }],
  "total": 12, "limit": 50, "offset": 0
}
```

### `GET /api/certificates/:id`

Auth: `@RequirePermission('certificate.read')`.

Summary + arrays embebidos:
```jsonc
{
  ...certificateSummary,
  "investor_returned": "0.5917",
  "payload_hash": "sha256-hex",
  "orders": [{
    "id": "uuid", "external_order_id": "ORD-001",
    "merchant": { "id": "uuid", "current_name": "...", "rif": "..." },
    "purchase_date": "2026-04-15", "max_due_date": "2026-05-25",
    "installments_sum_snapshot": "300.0000", "assigned_at": "2026-04-27T...",
    "installments": [
      { "installment_number": 1, "amount": "75.0000", "due_date": "2026-05-15", "status": "pending" }
    ]
  }],
  "events": [{ "id": "uuid", "event_type": "created", "occurred_at": "...", "payload": {...}, "actor_id": "uuid" }]
}
```

`installments_sum_snapshot` desde `cfb.certificate_orders` (capturado al emit). `404` si no existe o si `deleted_at IS NOT NULL` y caller no tiene `certificate.read_deleted` (slice 4c).

---

## 7. Manejo de errores

| Caso | Status | Mensaje |
|---|---|---|
| Sin Bearer / token inválido / not registered | 401 / 403 | EN (auth layer) |
| Sin permission | 403 | EN |
| Body Zod inválido | 400 | ES `"Datos de entrada inválidos"` |
| `:id` no UUID | 400 | NestJS default |
| Investor not found | 404 | ES |
| Investor `kind='internal'` | 400 | ES `"Inversor interno reservado para sweep"` |
| Investor `status='inactive'` | 400 | ES |
| RIF malformado en POST | 400 | ES `"RIF inválido"` |
| RIF duplicado | 409 | ES `"Inversor con ese RIF ya existe"` + `existing_id` |
| Pool vacío en simulate | 422 | ES `"No hay órdenes elegibles"` |
| Stale orders en issue (alguno ya assigned) | 409 | ES `"Orden(es) ya asignada(s)"` + `conflicting_order_ids[]` |
| Pool difiere entre cliente y server en issue | 422 | ES `"Pool inválido — re-corra /simulate"` |
| `expected_payload_hash` mismatch | 422 | ES `"Payload mismatch — re-corra /simulate"` |
| DB CHECK violation imprevista | 422 | ES (mapped) |
| Otros | 500 | ES generic, stack en log |

---

## 8. Observabilidad

Logs Pino en inglés con request-id + userId correlados:

- `{ msg: 'investor created', userId, investorId, rif, kind }`
- `{ msg: 'cert simulated', userId, investorId, capital, rate, termDays, poolSize, nominalActual, shortfallPct }`
- `{ msg: 'cert issued', userId, certId, certCode, investorId, capital, nominalActual, durationMs }`
- `{ msg: 'cert issuance failed', userId, reason: 'stale_orders'|'payload_mismatch'|'pool_empty'|'pool_mismatch', conflictingOrderIds? }`

Audit rows:
- `entity_type='investor', action='create'` con payload del row creado.
- `entity_type='certificate', action='create'` con payload `{ inputs, outputs, order_count, payload_hash }`.

**No se loguea**: el set completo de `order_ids` (puede ser largo). Sí loguea contadores.

---

## 9. Tests (Vitest)

| Archivo | Tipo | Tests |
|---|---|---|
| `pricing.test.ts` | unit puro | 7 |
| `pool-builder.test.ts` | unit puro | 8 |
| `payload-hash.test.ts` | unit puro | 4 |
| `iso-week.test.ts` | unit puro | 4 |
| `investors.service.test.ts` | unit (Prisma mock) | 6 |
| `investors.controller.test.ts` | integration (supertest) | 7 |
| `certificates.service.test.ts` | unit (Prisma mock) | 17 (7 simulate + 7 issue + 3 list/detail) |
| `certificates.controller.test.ts` | integration (supertest) | 9 |

**Total Slice 4a: ~62 tests nuevos**. Sumado a 136 existentes = **~198 al cierre**.

Helpers:
- `seedTestInvestor(prisma, overrides?)` — para tests integration.
- `seedTestEligibleOrders(prisma, count, opts)` — array de orders con `status='available'` y due dates dentro de un rango.

Reutiliza `mintTestJwt`, `mockAuthUser` de Slice 1.

Sin tests E2E contra Supabase real — Prisma mockeado. Smoke completo al cierre del slice.

---

## 10. Dependencias / migraciones

**Cero** dependencias nuevas. **Cero** migraciones SQL nuevas. Toda la estructura DB (tabla `certificates` con 9 CHECK constraints, `certificate_orders` con UNIQUE order_id y trigger `trg_co_maturity_boundary`, `certificate_events` inmutable, `certificate_sequence` singleton, función `next_certificate_code()`, partial unique sweep, índices `idx_certs_*`, `idx_co_*`, `idx_cert_events_*`) ya existe desde Slice 0.

---

## 11. Criterios de aceptación

Slice 4a listo cuando:

1. `pnpm test` pasa con ~62 tests nuevos verdes (~198 total).
2. `pnpm typecheck` y `pnpm lint` clean.
3. **Smoke contra Supabase real** (datos del Slice 2: 2 orders disponibles, $400 total `installments_sum`):
   - `POST /api/investors` con `{ legal_name: "Inversora Alpha, C.A.", rif: "J-30123456-7", kind: "juridica" }` → 201 con investor creado.
   - `POST /api/certificates/simulate` con `{ investor_id: <nuevo>, capital: 400, rate: 0.13, term_days: 42, issue_date: "2026-05-15" }`:
     - maturity = 2026-06-26
     - eligible: ambas órdenes (ambos `max_due_date` ≤ 2026-06-26)
     - greedy DESC: ORD-1 (300) adoptado → nominal=300; ORD-2 (100) → 300+100=400 ≤ 406.16 → adoptado → nominal=400
     - response: `pool.order_count=2`, `payouts.nominal_actual="400.0000"`, `pricing.price="0.984833"`, `pricing.nominal_target="406.1664"` (aprox)
   - `POST /api/certificates` con mismos params + `order_ids` del simulate + `expected_payload_hash` → 201 con `certificate_code` (próximo de la secuencia, ej. `C4572A`).
   - Verifico en DB:
     - `cfb.certificates` 1 row nuevo con valores correctos
     - `cfb.certificate_orders` 2 rows
     - `cfb.orders` ambas con `status='assigned'`
     - `cfb.order_events` 2 rows nuevos (`event_type='status_change'`)
     - `cfb.certificate_events` 1 row (`event_type='created'`)
     - `cfb.audit_log` 2 rows nuevos (1 investor.create + 1 certificate.create)
   - `GET /api/certificates` → 200 con 1 cert.
   - `GET /api/certificates/:id` → 200 con `orders[2]` y `events[≥1]`.
   - **Idempotency check**: re-POST mismo body → 409 (orders ya assigned, devuelve `conflicting_order_ids`).
4. `pnpm openapi:export` regenera con los 7 endpoints nuevos.

---

## 12. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Decimal precision divergence simulate↔issue | `payload_hash` check captura → 422 con mensaje claro. Frontend re-corre. |
| Race entre dos issues con orders solapadas | `SELECT FOR UPDATE` + `UNIQUE (order_id)` en `certificate_orders`. Segundo recibe 409. |
| `cycle_week` boundary año-bisiesto / W53 | Helper ISO 8601 con 4 tests cubriendo edge cases. |
| `next_certificate_code()` race | Función Postgres usa `UPDATE certificate_sequence` que serializa por row lock. Garantiza unicidad. |
| Greedy descending sub-óptimo | Es el algoritmo del producto (declarado en screenshot). Si surge insatisfacción, slice futuro agrega heurística alternativa. |
| Operador con `issue_date` muy en el futuro | Validación: `issue_date >= today`. Sin upper bound. Audit log captura todo. |
| Pool muy grande (>2000 orders) | Body limit `order_ids ≤ 2000`. Suficiente para >>10x el caso del screenshot. Si crece, paginar. |
| Investor `kind='internal'` mal usado | Validación 400 explícita. Sweep tendrá su propio endpoint en 4b. |
| Operador olvida actualizar `expected_payload_hash` después de cambiar params en UI | 422 con mensaje claro lo redirige a `/simulate` re-run. |

---

## 13. Siguiente paso

Tras aprobación → invocar `superpowers:writing-plans`.
