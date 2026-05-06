# Slice 3 — Cartera (Portfolio): diseño

**Fecha**: 2026-05-06
**Autor**: armandogois@cashea.app + Claude (brainstorming)
**Estado**: en revisión
**Próximo paso**: tras aprobación, invocar writing-plans
**Depende de**: Slice 0 (Foundation), Slice 1 (Auth), Slice 2 (Ingestión) — todos en `main`.

---

## 1. Objetivo

Exponer endpoints de lectura sobre el dominio cartera (orders, installments, merchants, end_users) que el equipo de Tesorería usa para navegar la data ingerida y planificar emisión de certificados. Incluye un único endpoint de mutación: `PATCH /api/end-users/:id`, que permite enriquecer un end_user con identificación real (cédula, nombre, contacto) después de la ingestión inicial. Todo cambio de end_user queda registrado en `cfb.audit_log`.

### Por qué importa

- Slice 4 (Emisión) requiere `GET /api/orders` con filtros `status='available' AND max_due_date <= cert.maturity_date` para que el operador pueda elegir qué órdenes meter en un certificado.
- El dashboard del frontend necesita stats agregadas (capital disponible para emisión) y navegación por merchant/end_user.
- El `audit_log` queda activado a nivel sistema con `AuditService` reutilizable, listo para los slices que escriban data sensible (Slice 5 usuarios, certificados cancelados, etc.).

### Fuera de alcance

- Cualquier mutación sobre `orders`/`installments`/`merchants` — solo lectura. La fuente de truth de esa data es la ingestión (Slice 2) y los triggers de DB (status changes auto-loggeados).
- Endpoints de `order_events` y `installment_events` separados — los events vienen embebidos en `GET /api/orders/:id`.
- Detail endpoint de installment individual — YAGNI; las cuotas están en `GET /api/orders/:id`.
- Bulk operations (PATCH masivo de end_users, etc.).
- Full-text search (Postgres `pg_trgm`) — `q` substring sirve por volumen actual.
- Eliminación de end_users (no es un caso de uso del producto).

---

## 2. Decisiones tomadas

1. **Scope C + PATCH end-users**: 4 entidades (orders, merchants, end_users, installments) con 9 endpoints en total.
2. **Solo `portfolio.read` para GETs, `portfolio.write` para PATCH** — ambos seedeados en Slice 0, no requiere migración nueva.
3. **PATCH end-users con 4 campos editables** (`full_name`, `national_id`, `email`, `phone`), validación **mixta**: email format strict, otros solo length 1-255. Permite `null` para clear.
4. **Audit log entry por cada PATCH que produzca diff real**. No-op (mismo body) → no audit row. `enriched_at` se setea solo si hay diff.
5. **Decimal serialization como string** (igual que Slices 1-2).
6. **Merchant/EndUser detail incluyen `orders_summary`** (count + total + by_status) — útil para operador, query agregada barata.
7. **`AuditService` como módulo `@Global()`** — reutilizable, acepta opcional `tx` para incluirse en transacción del caller.
8. **Pagination shape compartida** (`limit` 1-200 default 50, `offset` >=0 default 0) en `src/common/dto/pagination.schema.ts`.
9. **Mensajes al cliente en español** (regla CLAUDE.md general). Auth-layer messages en inglés (excepción documentada en memory desde Slice 1).
10. **Sin nuevas dependencias** — Slice 3 reutiliza Prisma, Zod, NestJS, Vitest, supertest, jose.
11. **Sin migraciones SQL nuevas** — todas las queries usan índices existentes de Slice 0 (`idx_orders_eligibility`, `idx_orders_purchase`, `idx_merchants_name`, `idx_installments_due_status`, etc.).

---

## 3. Arquitectura

```
src/modules/audit/                         ← NUEVO @Global module
  audit.module.ts
  audit.service.ts                         ← AuditService.recordChange()
  audit.service.test.ts
  types.ts

src/modules/portfolio/
  portfolio.module.ts                      ← agrupa 4 sub-controllers
  orders/
    orders.controller.ts                   ← GET list, GET :id, GET stats
    orders.service.ts
    orders.service.test.ts
    orders.controller.test.ts
    orders.dto.ts                          ← Zod schemas
    responses/
      order-summary.mapper.ts              ← Prisma row → API list shape
      order-detail.mapper.ts               ← Prisma row → API detail with installments+events
      order-stats.mapper.ts                ← groupBy result → stats shape
  merchants/
    merchants.controller.ts                ← GET list, GET :id
    merchants.service.ts
    merchants.service.test.ts
    merchants.controller.test.ts
    merchants.dto.ts
    responses/
      merchant-summary.mapper.ts
      merchant-detail.mapper.ts
  end-users/
    end-users.controller.ts                ← GET list, GET :id, PATCH :id
    end-users.service.ts
    end-users.service.test.ts
    end-users.controller.test.ts
    end-users.dto.ts                       ← include EndUserUpdateSchema
    responses/
      end-user-summary.mapper.ts
      end-user-detail.mapper.ts
  installments/
    installments.controller.ts             ← GET list
    installments.service.ts
    installments.service.test.ts
    installments.controller.test.ts
    installments.dto.ts
    responses/
      installment-summary.mapper.ts

src/common/dto/
  pagination.schema.ts                     ← Zod helper compartido
  pagination.schema.test.ts

src/app.module.ts                          ← MODIFY: import AuditModule + PortfolioModule
```

`PortfolioModule` agrupa los 4 sub-módulos en un solo module. Si crecen, los podemos splitear en una iteración futura. AuditModule es `@Global()` y se importa una sola vez en AppModule.

---

## 4. Endpoints — Orders

### `GET /api/orders` (list paginada)

Auth: `@RequirePermission('portfolio.read')`.

**Query DTO**:
```ts
export const OrdersListQuerySchema = PaginationSchema.extend({
  status: z.enum(['available','assigned','matured','defaulted']).optional(),
  merchant_id: z.string().uuid().optional(),
  end_user_id: z.string().uuid().optional(),
  batch_id: z.string().uuid().optional(),
  purchase_date_from: z.coerce.date().optional(),
  purchase_date_to: z.coerce.date().optional(),
  max_due_date_lte: z.coerce.date().optional(),       // clave para Slice 4
  q: z.string().min(1).max(100).optional(),            // substring sobre external_order_id
  sort: z.enum(['purchase_date_desc','purchase_date_asc','max_due_date_asc','max_due_date_desc']).default('purchase_date_desc'),
});
```

**Response**:
```jsonc
{
  "data": [
    {
      "id": "uuid",
      "external_order_id": "ORD-SMOKE-1",
      "status": "available",
      "purchase_date": "2026-04-01",
      "max_due_date": "2026-05-13",
      "total_amount": "300.0000",
      "installments_sum": "300.0000",
      "num_installments": 3,
      "imported_at": "2026-05-06T12:59:47.000Z",
      "merchant":  { "id": "uuid", "current_name": "Mercantil C.A.", "rif": "J-12345678-9" },
      "end_user":  { "id": "uuid", "external_hash": "smoke-user-1", "national_id": null, "full_name": null },
      "batch":     { "id": "uuid", "external_code": "B-20260506-125940" }
    }
  ],
  "total": 2,
  "limit": 50,
  "offset": 0
}
```

Implementación: `prisma.order.findMany({ where, include: { merchant, end_user, batch }, take, skip, orderBy })`. El index `idx_orders_eligibility` (partial WHERE `status='available'`) acelera la query crítica de emisión.

### `GET /api/orders/:id` (detail)

Auth: `@RequirePermission('portfolio.read')`.

**Response**: el summary + arrays embebidos:
```jsonc
{
  ...orderSummary,
  "installments": [
    { "id": "uuid", "external_installment_id": "INST-SMOKE-1-1", "installment_number": 1, "amount": "75.0000", "due_date": "2026-04-15", "status": "pending", "paid_amount": null }
  ],
  "events": [
    { "id": "uuid", "event_type": "status_change", "occurred_at": "2026-05-06T...", "payload": {...}, "actor_id": "uuid" }
  ]
}
```

`installments` ordenadas por `installment_number ASC`. `events` ordenados por `occurred_at DESC`, capped a 50 (los logs antiguos no caben en una respuesta razonable).

`404` si `:id` no existe.

### `GET /api/orders/stats`

Auth: `@RequirePermission('portfolio.read')`.

Acepta los **mismos filtros** que la list (excepto `q`, `sort`, `limit`, `offset`).

**Response**:
```jsonc
{
  "by_status": {
    "available":  { "count": 420, "total_amount": "150000.0000", "total_installments_amount": "112500.0000" },
    "assigned":   { "count": 12,  "total_amount": "8500.0000",   "total_installments_amount": "6375.0000" },
    "matured":    { "count": 0,   "total_amount": "0.0000",      "total_installments_amount": "0.0000" },
    "defaulted":  { "count": 0,   "total_amount": "0.0000",      "total_installments_amount": "0.0000" }
  },
  "total_orders": 432,
  "available_capital": "112500.0000"
}
```

Implementación: `prisma.order.groupBy({ by: ['status'], where, _count: true, _sum: { total_amount, installments_sum } })`. Las 4 filas devueltas se mappean a `by_status` (zeros donde el status no aparezca).

`available_capital` = `by_status.available.total_installments_amount`. Es el "nominal target" máximo que cubre un certificado bajo los filtros aplicados.

---

## 5. Endpoints — Merchants

### `GET /api/merchants` (list)

Auth: `@RequirePermission('portfolio.read')`.

**Query**:
```ts
PaginationSchema.extend({
  q: z.string().min(1).max(100).optional(),    // substring case-insensitive en current_name OR rif
  sort: z.enum(['name_asc','name_desc','last_seen_desc']).default('name_asc'),
})
```

**Response**:
```jsonc
{
  "data": [
    {
      "id": "uuid",
      "rif": "J-12345678-9",
      "current_name": "Mercantil C.A.",
      "first_seen_at": "2026-05-06T12:59:47.000Z",
      "last_seen_at":  "2026-05-06T12:59:47.000Z",
      "order_count": 1,
      "total_orders_amount": "300.0000"
    }
  ],
  "total": 2,
  "limit": 50,
  "offset": 0
}
```

`order_count` y `total_orders_amount` calculados via `_count` + agregación por separado en el service.

### `GET /api/merchants/:id` (detail)

Auth: `@RequirePermission('portfolio.read')`.

```jsonc
{
  ...merchantSummary,
  "name_history": [
    { "id": "uuid", "name": "Mercantil C.A.", "effective_from": "2026-04-01", "effective_to": null },
    { "id": "uuid", "name": "Mercantil S.A.", "effective_from": "2025-01-01", "effective_to": "2026-04-01" }
  ],
  "orders_summary": {
    "total_count": 1,
    "total_amount": "300.0000",
    "by_status": { "available": 1, "assigned": 0, "matured": 0, "defaulted": 0 }
  }
}
```

`name_history` ordenado por `effective_from DESC`. `orders_summary.by_status` solo cuenta (sin amounts). `404` si no existe.

---

## 6. Endpoints — End-Users

### `GET /api/end-users` (list)

Auth: `@RequirePermission('portfolio.read')`.

**Query**:
```ts
PaginationSchema.extend({
  q: z.string().min(1).max(100).optional(),         // substring sobre external_hash, full_name, national_id, email, phone
  has_national_id: z.coerce.boolean().optional(),
  sort: z.enum(['last_seen_desc','first_seen_desc','external_hash_asc']).default('last_seen_desc'),
})
```

**Response**:
```jsonc
{
  "data": [
    {
      "id": "uuid",
      "external_hash": "smoke-user-1",
      "full_name": null,
      "national_id": null,
      "email": null,
      "phone": null,
      "enriched_at": null,
      "first_seen_at": "2026-05-06T12:59:47.000Z",
      "last_seen_at":  "2026-05-06T12:59:47.000Z",
      "order_count": 1
    }
  ],
  "total": 2,
  "limit": 50,
  "offset": 0
}
```

`q` busca con `OR` sobre 5 campos textuales, case-insensitive (`ILIKE '%q%'`).

### `GET /api/end-users/:id` (detail)

Auth: `@RequirePermission('portfolio.read')`.

```jsonc
{
  ...endUserSummary,
  "orders_summary": {
    "total_count": 1,
    "total_amount": "300.0000",
    "by_status": { "available": 1, "assigned": 0, "matured": 0, "defaulted": 0 }
  }
}
```

`404` si no existe.

### `PATCH /api/end-users/:id`

Auth: `@RequirePermission('portfolio.write')`.

**Body schema**:
```ts
export const EndUserUpdateSchema = z.object({
  full_name:   z.string().min(1).max(255).nullable().optional(),
  national_id: z.string().min(1).max(255).nullable().optional(),
  email:       z.string().email().max(255).nullable().optional(),
  phone:       z.string().min(1).max(255).nullable().optional(),
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: 'Al menos un campo debe ser provisto' },
);
```

- 4 campos opcionales: omitir = no cambiar; `null` = clear; string = set.
- Email valida formato (Zod `.email()`).
- Otros solo length 1-255.
- Body vacío `{}` → 400 (refine).

**Lógica del service** (transacción Prisma):
1. `findUnique` por id → si null, 404 `"End user no encontrado"`.
2. Computar diff: solo campos donde `patch[k] !== before[k]`.
3. Si diff vacío: return current detail (no-op, sin update, sin audit row).
4. `update` con `{ ...diff, enriched_at: new Date() }`.
5. `AuditService.recordChange({ entityType: 'end_user', entityId: id, action: 'update', actorId, payload: { before: changedSlice, after: changedSlice }, tx })`.
6. Recalcular `orders_summary` para la response.
7. Return `EndUserDetail`.

**Response**: mismo shape que `GET /api/end-users/:id`.

---

## 7. Endpoint — Installments

### `GET /api/installments` (list)

Auth: `@RequirePermission('portfolio.read')`.

**Query**:
```ts
PaginationSchema.extend({
  status: z.enum(['pending','due','paid','overdue']).optional(),
  order_id: z.string().uuid().optional(),
  due_date_from: z.coerce.date().optional(),
  due_date_to: z.coerce.date().optional(),
  sort: z.enum(['due_date_asc','due_date_desc','amount_desc']).default('due_date_asc'),
})
```

**Response**:
```jsonc
{
  "data": [
    {
      "id": "uuid",
      "external_installment_id": "INST-SMOKE-1-1",
      "order_id": "uuid",
      "installment_number": 1,
      "amount": "75.0000",
      "due_date": "2026-04-15",
      "status": "pending",
      "paid_amount": null,
      "order": {
        "external_order_id": "ORD-SMOKE-1",
        "merchant": { "current_name": "Mercantil C.A.", "rif": "J-12345678-9" }
      }
    }
  ],
  "total": 5,
  "limit": 50,
  "offset": 0
}
```

Caso de uso típico: `GET /api/installments?status=pending&due_date_from=2026-05-06&due_date_to=2026-05-13` → cuotas que vencen en los próximos 7 días.

Sin endpoint de detail individual. YAGNI.

---

## 8. AuditService

Módulo nuevo `src/modules/audit/`, decorado `@Global()` para inyección directa desde cualquier módulo.

```ts
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async recordChange(opts: {
    entityType: 'batch'|'order'|'installment'|'certificate'|'certificate_order'
              |'investor'|'merchant'|'end_user'|'user'|'setting'|'system',
    entityId: string,                  // typically UUID, fits varchar(50)
    action: string,                    // 'create'|'update'|'delete'|...
    actorId: string,                   // cfb.users.id
    payload: Record<string, unknown>,  // arbitrary jsonb
    tx?: Prisma.TransactionClient,
  }): Promise<void> {
    const client = opts.tx ?? this.prisma;
    await client.auditLog.create({
      data: {
        entity_type: opts.entityType,
        entity_id: opts.entityId,
        action: opts.action,
        actor_id: opts.actorId,
        payload: opts.payload as Prisma.InputJsonValue,
      },
    });
  }
}
```

La tabla `cfb.audit_log` tiene trigger `trg_audit_log_immutable` que bloquea UPDATE/DELETE — solo INSERT permitido. No problem porque solo llamamos `.create`.

`AuditModule` exporta `AuditService` y `@Global()` la hace inyectable sin imports explícitos en cada feature module.

---

## 9. Manejo de errores

| Caso | Status | Mensaje | Quién emite |
|---|---|---|---|
| Sin Bearer token | 401 | `Missing or malformed Authorization header` (EN) | JwtAuthGuard |
| Token inválido / expirado | 401 | `Invalid or expired token` (EN) | JwtAuthGuard |
| User no en `cfb.users` | 403 | `User not registered in the system` (EN) | JwtAuthGuard |
| Sin `portfolio.read` (cualquier GET) | 403 | `Permission denied: portfolio.read` (EN) | PermissionsGuard |
| Sin `portfolio.write` (PATCH) | 403 | `Permission denied: portfolio.write` (EN) | PermissionsGuard |
| Query Zod inválido | 400 | `Datos de entrada inválidos` + errors[] (ES) | ZodValidationPipe |
| Body PATCH vacío `{}` | 400 | `Al menos un campo debe ser provisto` (ES) | Zod refine |
| `:id` no existe | 404 | `<Entidad> no encontrad{a/o}` (ES) | service throws NotFoundException |
| `:id` no es UUID | 400 | NestJS default | ParseUUIDPipe |
| DB / Supabase failure | 500 | `Ocurrió un error inesperado` (ES) | AllExceptionsFilter |

Todos los GETs son idempotent + safe. PATCH es idempotent (mismo body produce mismo estado, sin re-stamp de `enriched_at` si no hay diff).

---

## 10. Observabilidad

Logs Pino en inglés, request-id + userId correlados (heredado de Slice 1).

**Eventos auth-específicos** ya están desde Slice 1. Slice 3 agrega:

- `{ msg: 'audit recorded', entityType, entityId, action, actorId, requestId }` — info, en `AuditService.recordChange`.
- `{ msg: 'end_user enriched', userId, endUserId, fieldsChanged: [...] }` — info, en `EndUsersService.update` cuando hay diff. **No incluye valores** (PII).

**No se loguea**: email, national_id, phone, full_name. Solo nombres de campos cambiados, no los valores.

---

## 11. Tests (Vitest)

| Archivo | Tipo | Tests |
|---|---|---|
| `pagination.schema.test.ts` | unit | 3 (default, max limit, negative offset rechazado) |
| `audit.service.test.ts` | unit | 2 (insert con prisma propio, insert con tx del caller) |
| `orders.service.test.ts` | unit (Prisma mock) | 6 |
| `orders.controller.test.ts` | integration | 5 |
| `merchants.service.test.ts` | unit | 4 |
| `merchants.controller.test.ts` | integration | 3 |
| `end-users.service.test.ts` | unit | 8 |
| `end-users.controller.test.ts` | integration | 6 |
| `installments.service.test.ts` | unit | 3 |
| `installments.controller.test.ts` | integration | 2 |

**Total**: ~42 tests nuevos. Sumado a 91 existentes = **~133 al cierre**.

Helpers reutilizables (no commiteados como fixtures, generados en tests):
- `seedTestOrder(prisma, overrides?)` — útil si algún test necesita rows reales.
- Reutiliza `mintTestJwt`, `mockAuthUser`, `buildWorkbook` (este último no se usa en Slice 3 pero existe).

Sin tests E2E contra Supabase real — Prisma mockeado en todos los tests. Smoke completo al cierre del slice.

---

## 12. Dependencias nuevas

**Cero**. Reusa lo de Slices 0-2.

## 13. Migraciones SQL nuevas

**Ninguna**. Todos los queries usan índices existentes:
- `idx_orders_eligibility` (partial WHERE `status='available'`) — para emisión.
- `idx_orders_purchase`, `idx_orders_merchant`, `idx_orders_end_user`, `idx_orders_batch`.
- `idx_merchants_name`, `merchants_rif_key`.
- `idx_end_users_national_id` (partial), `end_users_external_hash_key`.
- `idx_installments_due_status`, `idx_installments_status`.
- `idx_audit_action`, `idx_audit_actor`, `idx_audit_entity`, `idx_audit_occurred`.

---

## 14. Criterios de aceptación

1. `pnpm test` corre con ~42 tests nuevos verdes (~133 total).
2. `pnpm typecheck` y `pnpm lint` clean.
3. **Smoke real contra Supabase** (los 2 orders del Slice 2 ya están en DB):
   - `GET /api/orders` → 200 con 2 orders.
   - `GET /api/orders?status=available` → 200 con 2 orders.
   - `GET /api/orders?max_due_date_lte=2026-04-30` → 200 con 1 order (Bodegón XYZ, max 2026-04-30).
   - `GET /api/orders/:id` → 200 con `installments[]` (3 o 2 según el id).
   - `GET /api/orders/stats` → 200 con `available_capital: "400.0000"` y `total_orders: 2`.
   - `GET /api/merchants` → 200 con 2 merchants.
   - `GET /api/merchants?q=Bodeg` → 200 con 1 merchant (Bodegón XYZ).
   - `GET /api/merchants/:id` → 200 con `name_history` (1 row) y `orders_summary`.
   - `GET /api/end-users` → 200 con 2 users.
   - `GET /api/end-users?q=smoke-user-1` → 200 con 1 user.
   - `PATCH /api/end-users/:id` con `{ "national_id": "V-12345678", "full_name": "Pedro Pérez" }` → 200, response refleja cambios, `enriched_at` no null.
   - Verifico en `cfb.audit_log` que se insertó row con `entity_type='end_user'`, `action='update'`, `payload.after` con los 2 campos cambiados.
   - `GET /api/installments?status=pending` → 200 con 5 cuotas.
4. `pnpm openapi:export` regenera `openapi.json` con los 9 endpoints nuevos visibles + el PATCH con body schema documentado.
5. `cfb.audit_log` tiene al menos 1 row después del PATCH del smoke.

---

## 15. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| `prisma.merchant.findMany({ include: { _count } })` se vuelve lento con muchos merchants | Aceptable hoy (cientos). Si crece, raw query con `LEFT JOIN LATERAL` o materialized view. Out of scope. |
| `q` substring search sin índices full-text en end_users | Aceptable hoy. `pg_trgm` index si crece — futura iteración. |
| Audit log inflation | Solo 1 endpoint mutation en este slice. Volumen bajo. |
| `email` strict validation rechaza emails con caracteres válidos pero raros | Zod's `.email()` razonable; si hay false positives, swap por regex custom. |
| Decimal precision en `_sum` | Prisma's Decimal preserva precisión. `.toFixed(4)` antes del JSON. |
| Operador updatea `national_id` con valor que ya tiene otro end_user | DB no tiene UNIQUE en `national_id`. Update succeeds. KYC dedup en slice futuro. |
| `groupBy` con muchos rows en stats | Postgres `GROUP BY` con index sobre status es eficiente. Sin issues a escala esperada. |

---

## 16. Siguiente paso

Tras aprobación → invocar `superpowers:writing-plans`.
