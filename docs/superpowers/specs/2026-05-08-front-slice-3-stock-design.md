# Frontend Slice 3 — `/stock` (Stock de órdenes) Design Spec

**Fecha:** 2026-05-08
**Estado:** Aprobado, listo para implementation plan
**Repo afectado:** `araguaney_front` (Slice 2 `/batches` ya en producción)
**Repo dependiente:** `araguaney_back` con portfolio (`/api/orders*`, `/api/merchants*`) e issuance (`/api/certificates*`) ya desplegados en Railway

---

## Goal

Permitir que el operador de Tesorería navegue las órdenes ingresadas desde los lotes — vea cuánto capital hay disponible para empaquetar en certificados, filtre por estado / comercio / fecha de vencimiento, y encuentre órdenes específicas por código. Es la pantalla de preparación inmediatamente previa al Slice 4 (emisión); sin Stock no hay manera de elegir qué órdenes meter en un certificado.

## Non-Goals (YAGNI)

- **Detail view de orden** (cuotas + events del schedule) — requiere `GET /api/orders/:id`, panel/drawer adicional. Difiere a Slice 3b si Tesorería lo pide para troubleshooting.
- **Filter por end_user, batch_id, fecha de compra rango** — el back los acepta pero el operador ya tiene status + comercio + max_due_date como discriminadores principales. YAGNI hasta evidencia de uso.
- **Autocomplete fancy del dropdown de comercios** — la lista actual es ~470 merchants; un `<select>` nativo + scroll basta. Subir a `cmdk` u otro combobox cuando supere 1k.
- **Concentración por comercio** (las barritas del mockup `443031f2`) — vive naturalmente en el modal de "Nuevo certificado" cuando llegue Slice 4. Acá sería ruido.
- **Distribución de vencimientos** (timeline del mockup) — mismo razonamiento: pertenece al simulador de Slice 4.
- **Exportar tabla a CSV** — YAGNI hasta que un operador lo pida explícitamente.
- **DataTable reusable** — la tabla del Stock se construye ad-hoc igual que `BatchesTable`. Cuando haya un tercer caller (Comercios, Inversores) extraemos un componente compartido.
- **Saved filters / URL state sync** — los filtros viven en React state, se pierden al refrescar. Suficiente para uso operativo; URL sync se agrega cuando Tesorería pegue links entre sí.

## Decisiones cerradas (Q&A brainstorm)

| Q | Decisión | Razón |
|---|---|---|
| Caso de uso primario | Navegar para emisión (banner stats + tabla con filtros) | Es lo que desbloquea Slice 4; troubleshooting/auditoría es secundario |
| Filtros incluidos | Status, Comercio, Vence antes de, Búsqueda por código | Los 4 que cubren el flujo "preparar pool"; los otros 4 que ofrece el back son YAGNI |
| Banner stats | 3 cards: Capital disponible · Órdenes disponibles · Certs emitidos esta semana | "Total ingresado" no le importa al operador; "esta semana" da contexto del ritmo de emisión |
| Endpoints | Solo lectura: `/api/orders`, `/api/orders/stats`, `/api/merchants`, `/api/certificates` | Sin nuevos endpoints en el back |
| Detail view | Fuera de scope | Decisión explícita del usuario; clickear una fila no hace nada por ahora |
| Status default | "Disponibles" (status=available) | Es lo que el operador quiere ver el 90% del tiempo |
| Pagination | 50/página, controles `← →` simples | Mismo patrón que Slice 2; volúmenes esperados (~50k órdenes activas) caben en 1000 páginas |
| Permisos | `portfolio.read` (ya seedeado en back Slice 0) | El back tira 403 si falta; mostramos empty state con mensaje |

## Hallazgos del back (relevantes)

### `GET /api/orders` (list)

Permission: `portfolio.read`. Query schema:

```ts
{
  limit: 1-200 (default 50),
  offset: >=0 (default 0),
  status?: 'available' | 'assigned' | 'matured' | 'defaulted',
  merchant_id?: uuid,
  end_user_id?: uuid,           // no usado en Slice 3
  batch_id?: uuid,              // no usado en Slice 3
  purchase_date_from?: date,    // no usado en Slice 3
  purchase_date_to?: date,      // no usado en Slice 3
  max_due_date_lte?: date,
  q?: string,                   // substring sobre external_order_id
  sort?: 'purchase_date_desc' | 'purchase_date_asc' | 'max_due_date_asc' | 'max_due_date_desc',
}
```

Response shape (hand-typed en el front, idéntico al spec del back Slice 3):

```ts
type OrderSummary = {
  id: string;
  external_order_id: string;
  status: 'available' | 'assigned' | 'matured' | 'defaulted';
  purchase_date: string;        // ISO date
  max_due_date: string;
  total_amount: string;          // Decimal as string
  installments_sum: string;
  num_installments: number;
  imported_at: string;
  merchant: { id: string; current_name: string; rif: string };
  end_user: { id: string; external_hash: string; national_id: string | null; full_name: string | null };
  batch:    { id: string; external_code: string };
};
type OrdersListResponse = { data: OrderSummary[]; total: number; limit: number; offset: number };
```

### `GET /api/orders/stats`

Mismos filtros que list excepto `q`, `sort`, `limit`, `offset`. En Slice 3 lo llamamos sin filtros — queremos los totales globales para el banner, no los del filtro actual.

```ts
type OrdersStats = {
  by_status: {
    available: { count: number; total_amount: string; total_installments_amount: string };
    assigned:  { count: number; total_amount: string; total_installments_amount: string };
    matured:   { count: number; total_amount: string; total_installments_amount: string };
    defaulted: { count: number; total_amount: string; total_installments_amount: string };
  };
  total_orders: number;
  available_capital: string;     // = by_status.available.total_installments_amount
};
```

### `GET /api/merchants` (dropdown)

Permission: `portfolio.read`. Aceptamos los defaults (limit=50). Para el dropdown del Stock pasamos `limit=200&sort=name_asc` (~470 totales hoy; carga total en una request, ningún problema). Si supera 200 el dropdown muestra los primeros 200 + un hint "filtrar por código" — no hacemos lazy load ni autocomplete en Slice 3.

```ts
type MerchantSummary = { id: string; rif: string; current_name: string; orders_count: number };
type MerchantsListResponse = { data: MerchantSummary[]; total: number; limit: number; offset: number };
```

### `GET /api/certificates`

Permission: `certificate.read`. Para el banner pasamos `issue_date_from=mondayThisWeek&issue_date_to=today&limit=1` y leemos solo el `total` de la respuesta. No nos interesan los certs en sí — solo cuántos.

`mondayThisWeek` se calcula client-side en `lib/format/date.ts` (hay helpers ya). UTC para evitar drift de timezone.

---

## Architecture

```
/stock (Server Component shell, 5 LOC, dynamic = 'force-dynamic')
  └─ <StockPage> (Client)
       ├─ <PageHeader breadcrumb="Operación · Stock de órdenes" />
       ├─ <StockStatsBanner>
       │    ├─ useQuery(['orders-stats'])      → GET /api/orders/stats
       │    └─ useQuery(['certs-this-week'])   → GET /api/certificates?issue_date_from=...&limit=1
       ├─ <StockFilters value={filters} onChange={setFilters}>
       │    ├─ status pills (segmented)
       │    ├─ merchant <select> (useQuery(['merchants']))
       │    ├─ <input type="date"> (max_due_date_lte)
       │    └─ <input> con debounce 300ms (q)
       └─ <StockTable filters={filters} page={page} onPageChange={setPage}>
            ├─ useQuery(['orders', filters, page]) → GET /api/orders?...
            ├─ <OrderRow order={...} />
            │    └─ <OrderStatusPill status={...} />
            └─ pagination footer (← N–M de TOTAL →)
```

**Server-first cuando se puede**: el `page.tsx` es Server Component y monta el cliente. Toda la lógica reactiva (queries, filtros, paginación) vive en clients.

**Modular por dominio**: `components/stock/` con 8 archivos chicos. `OrderStatusPill` reusa `<Pill>` de `components/ui/`.

**Cache strategy**: stats banner y merchants tienen `staleTime: 5*60*1000` (5 min) — no cambian mid-session. Tabla con `staleTime: 30*1000` (30s) para que el operador vea cambios reales si re-empaqueta. Window-focus refetch ON para orders, OFF para stats/merchants.

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `app/(app)/stock/page.tsx` | modify | Server Component, monta `<StockPage>` (reemplaza `<ComingSoon />`) |
| `components/stock/stock-page.tsx` | create | Client wrapper: header + banner + filters + table + page state |
| `components/stock/stock-page.test.tsx` | create | Smoke test integrado del flow completo |
| `components/stock/stock-stats-banner.tsx` | create | 3 cards con número grande + sub-label |
| `components/stock/stock-stats-banner.test.tsx` | create | Loading state, error state, valores formateados |
| `components/stock/stock-filters.tsx` | create | Status pills + merchant dropdown + date input + search |
| `components/stock/stock-filters.test.tsx` | create | onChange dispara con shape correcto, debounce funciona |
| `components/stock/stock-table.tsx` | create | TanStack useQuery + render de rows + paginación |
| `components/stock/stock-table.test.tsx` | create | Loading/error/empty/data, paginación |
| `components/stock/order-row.tsx` | create | Una fila: código, fecha, comercio, cuotas, monto, status |
| `components/stock/order-row.test.tsx` | create | Render correcto de campos formateados |
| `components/stock/order-status-pill.tsx` | create | `Pill` con tono según `available/assigned/matured/defaulted` |
| `components/stock/order-status-pill.test.tsx` | create | Color/texto por status |
| `lib/api/orders.ts` | create | Server Actions: `listOrders`, `getOrdersStats` |
| `lib/api/orders.test.ts` | create | Mock `apiFetch` y verifica path/query |
| `lib/api/merchants.ts` | create | Server Action: `listMerchants` |
| `lib/api/merchants.test.ts` | create | Mock `apiFetch` y verifica path |
| `lib/api/certificates.ts` | create | Server Action: `countCertificatesIssued(from, to)` |
| `lib/api/certificates.test.ts` | create | Mock `apiFetch` y verifica que retorna solo `total` |
| `lib/types/order.ts` | create | `OrderStatus`, `OrderSummary`, `OrdersListResponse`, `OrdersStats` |
| `lib/types/merchant.ts` | create | `MerchantSummary`, `MerchantsListResponse` |
| `lib/format/week.ts` | create | `mondayOfThisWeekUTC()`: helper puro para el `issue_date_from` del banner |
| `lib/format/week.test.ts` | create | Tests con varios días/timezones |

Total: 18 archivos nuevos, 1 modificado. Cada componente < 120 líneas.

---

## UI Spec

### Layout general

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Operación · Stock de órdenes                                             │
│ Stock de órdenes                                                          │
│                                                                          │
│ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐              │
│ │ CAPITAL DISP.   │ │ ÓRDENES DISP.   │ │ CERTS ESTA SEMANA│             │
│ │ $1,797,940.34   │ │ 17,794          │ │ 0 emitidos      │              │
│ │ nominal         │ │ disponibles     │ │ desde lun 04/05 │              │
│ └─────────────────┘ └─────────────────┘ └─────────────────┘              │
│                                                                          │
│ [Disponibles] Todas Asignadas Vencidas              [🔎 Código]         │
│ [Comercio ▾] [Vence antes de: 📅]                                        │
├──────────────────────────────────────────────────────────────────────────┤
│ CÓDIGO     │ FECHA      │ COMERCIO              │ CUOTAS │ MONTO    │ ESTADO     │
│ 85657474   │ 18/03/2026 │ CENTRAL MADEIRENSE   │ 3      │ $87.24   │ Disponible │
│ 85656105   │ 18/03/2026 │ GRUPO CANALETTO      │ 1      │ $26.07   │ Disponible │
│ ...                                                                      │
│                                                                          │
│ Mostrando 1–50 de 17,794                                  ←   →          │
└──────────────────────────────────────────────────────────────────────────┘
```

Tipografía/espaciado igual que Slice 2 (mismo `PageHeader`, mismo container `max-w-[1440px]`).

### Stat cards

Mismo patrón visual que `StatCard` del mockup `443031f2`:

```tsx
<div className="bg-card border-border-subtle rounded-lg border p-4">
  <div className="text-text-3 text-[10px] uppercase tracking-wide">CAPITAL DISP.</div>
  <div className="mt-1 text-[20px] font-semibold tabular-nums tracking-[-0.3px]">$1,797,940.34</div>
  <div className="text-text-3 mt-0.5 text-[11px]">nominal disponible</div>
</div>
```

3 cards en `grid grid-cols-3 gap-3` (en mobile collapse a 1 col, no es prioridad pero el grid responsive ya lo da).

Loading state: mismo card pero con `<Skeleton>` (extender el patrón existente — si no hay Skeleton en el repo, lo creamos como `components/ui/skeleton.tsx`).

Error state: card con `text-text-3` "—" en vez del valor + `text-rose-600` debajo "No se pudo cargar".

### Filters bar

Layout en 2 filas:

**Fila 1**: status pills (segmented control) + search input alineado a la derecha.

```tsx
<div className="flex items-center justify-between gap-4">
  <SegmentedControl
    value={status}
    onChange={setStatus}
    options={[
      { value: 'available', label: 'Disponibles' },  // default
      { value: 'all',       label: 'Todas' },
      { value: 'assigned',  label: 'Asignadas' },
      { value: 'matured',   label: 'Vencidas' },
    ]}
  />
  <Input placeholder="🔎 Código de orden" debounce={300} value={q} onChange={setQ} />
</div>
```

**Fila 2**: comercio dropdown + date picker.

```tsx
<div className="flex items-center gap-3">
  <Select label="Comercio" options={merchants} value={merchantId} onChange={setMerchantId} />
  <DateInput label="Vence antes de" value={maxDueDateLte} onChange={setMaxDueDateLte} />
</div>
```

Los controles (segmented status, native `<select>`, native `<input type="date">`, search input con debounce) se construyen **inline en `stock-filters.tsx`** con clases Tailwind directamente. No promovemos componentes a `components/ui/` en este Slice — YAGNI hasta que un segundo lugar los necesite. La fila completa cabe < 120 líneas.

Status pills layout exact: tomado del `TermToggle` del mockup `443031f2:42`. Borde 0.5px, padding interno 3px, item activo con fondo `#0A0A0A` y texto blanco.

### Tabla

Columns: `external_order_id` (mono) | `purchase_date` (DD/MM/YYYY) | `merchant.current_name` (truncate) | `num_installments` | `installments_sum` ($X) | status pill.

`tabular-nums` en código, fecha, cuotas, monto. Truncate con tooltip en comercio cuando excede.

Header sticky (igual que Slice 2). Paginación al final con counts: `Mostrando {offset+1}–{min(offset+limit, total)} de {total}`. Botones `← →` deshabilitados en boundaries.

Empty state (cuando filters dan 0 resultados): centrado `text-text-3` con "Ningún resultado para los filtros aplicados. Probá ajustarlos."

Loading state: 5 filas skeleton.

Error state: `text-rose-600` "No se pudieron cargar las órdenes" + retry button (re-runs la query).

### Status pill

```ts
const PILL_TONE: Record<OrderStatus, 'green' | 'amber' | 'gray' | 'red'> = {
  available: 'green',
  assigned:  'amber',
  matured:   'gray',
  defaulted: 'red',
};
const PILL_LABEL: Record<OrderStatus, string> = {
  available: 'Disponible',
  assigned:  'Asignada',
  matured:   'Vencida',
  defaulted: 'Defaulteada',
};
```

Reusa `<Pill>` de `components/ui/pill.tsx` (existe desde Slice 2).

---

## Data Fetching

### TanStack Query

3 queries hot:

```ts
// Banner
const stats = useQuery({
  queryKey: ['orders-stats'],
  queryFn: () => getOrdersStats(),
  staleTime: 5 * 60 * 1000,        // 5 min
  refetchOnWindowFocus: false,
});

const certsThisWeek = useQuery({
  queryKey: ['certs-this-week'],
  queryFn: () => countCertificatesIssued(mondayOfThisWeekUTC(), todayUTC()),
  staleTime: 5 * 60 * 1000,
  refetchOnWindowFocus: false,
});

const merchants = useQuery({
  queryKey: ['merchants'],
  queryFn: () => listMerchants({ limit: 200, sort: 'name_asc' }),
  staleTime: 10 * 60 * 1000,       // 10 min — casi nunca cambia
  refetchOnWindowFocus: false,
});

// Tabla
const orders = useQuery({
  queryKey: ['orders', filters, page],
  queryFn: () => listOrders({ ...filters, limit: 50, offset: page * 50 }),
  staleTime: 30 * 1000,             // 30s
  refetchOnWindowFocus: true,
  placeholderData: (prev) => prev,  // keep prior page mientras carga la nueva (smooth pagination)
});
```

### Server Actions

`lib/api/orders.ts`:

```ts
'use server';
export async function listOrders(params: ListOrdersParams): Promise<OrdersListResponse> { ... }
export async function getOrdersStats(): Promise<OrdersStats> { ... }
```

Patrón de `rethrowWithMessage` igual que `lib/api/batches.ts` — captura `ApiError` y re-lanza `Error` plano con `body.message` para que el front no enmascare con `instanceof ApiError`.

`lib/api/merchants.ts` y `lib/api/certificates.ts` siguen el mismo molde.

---

## Error Handling

| Situación | UX |
|---|---|
| 401 (token expirado) | El layout protegido redirige a `/auth/clear` (existing behavior) |
| 403 (sin `portfolio.read`) | Empty state: "No tenés permiso para ver el stock de órdenes. Contactá a un admin." |
| 5xx en stats | Cards muestran "—" + mensaje de error en sub-label, tabla sigue cargando |
| 5xx en orders list | Tabla muestra error state con retry button; banner sigue OK |
| Network error | Toast `sonner` con mensaje genérico + retry; queries quedan en `error` state |
| Filters dan 0 results | Empty state amigable, no es error |

Sin error boundary global custom — el del App Router de Next es suficiente para el rendering del page.

---

## Permissions

Solo `portfolio.read`. Todos los roles lo tienen seedeados desde Slice 0 del back. Si Tesorería en el futuro quiere restringir Stock (ej. solo `operator` lo ve), se hace en el back actualizando `cfb.role_permissions` — sin cambios de front.

---

## Testing

| Archivo | Tipo | Tests aproximados |
|---|---|---|
| `lib/api/orders.test.ts` | unit (mock apiFetch) | 4 (list con/sin params, stats, error) |
| `lib/api/merchants.test.ts` | unit | 1 (list call shape) |
| `lib/api/certificates.test.ts` | unit | 2 (count returns total, date params correctos) |
| `lib/format/week.test.ts` | unit | 4 (lunes, domingo, sábado, edge timezones) |
| `components/stock/order-status-pill.test.tsx` | unit | 4 (uno por status) |
| `components/stock/order-row.test.tsx` | unit | 3 (render, formato monto, formato fecha) |
| `components/stock/stock-stats-banner.test.tsx` | unit | 4 (loading, error, success, formato) |
| `components/stock/stock-filters.test.tsx` | unit | 5 (status change, search debounce, merchant select, date input, default state) |
| `components/stock/stock-table.test.tsx` | unit | 5 (loading, empty, error, data render, pagination) |
| `components/stock/stock-page.test.tsx` | smoke integrado | 2 (full render, filter cambia query) |

**Total**: ~34 tests nuevos.

Mismo setup que Slice 2: vitest + react-testing-library + jsdom. `renderWithQuery` helper ya existe en `test/helpers/tanstack.tsx`. Sin Playwright/E2E (consistente con scope previo).

Mocks:
- TanStack queries via `mockApiFetch` igual que Slice 2.
- Helpers: `mockOrder()`, `mockMerchant()`, `mockOrdersStats()` en `test/helpers/stock.ts`.

---

## Smoke Plan (manual)

Después del deploy a Vercel:

1. Login como `operator`.
2. Navegar a `/stock`. Banner debe mostrar `Capital disponible` con monto real (~$1,797,940.34 después de Lote_00109), `Órdenes disponibles` 17,794, `Certs esta semana` 0.
3. Tabla debe mostrar las primeras 50 órdenes en status `available` ordenadas por `purchase_date_desc`.
4. Cambiar status pill a "Todas" → tabla recarga, count cambia.
5. Buscar `8565` en el campo de código → tabla filtra después de 300ms de debounce.
6. Seleccionar un comercio del dropdown → tabla filtra.
7. Setear "Vence antes de" a una fecha → tabla filtra.
8. Limpiar filtros → tabla vuelve al estado default.
9. Click `→` para paginar → carga la siguiente página, banner stats no recarga.
10. Refresh window → filtros vuelven al default (sin URL state sync por decisión explícita; se restablece "Disponibles" + sin búsqueda).

---

## Out of Scope (recordatorio)

| | |
|---|---|
| Detail view (drawer / page) | Slice 3b |
| Filtros por end_user / batch / fecha de compra | Slice 3b si pedidos |
| Concentración / vencimientos timeline | Slice 4 (modal de Nuevo Certificado) |
| Export CSV | Cuando un operador lo pida |
| URL state sync | Cuando Tesorería pegue links |
| Autocomplete en dropdown de comercios | Cuando supere 1k merchants |

---

## Dependencias

- TanStack Query v5 (existente)
- shadcn `<Pill>` (existente, Slice 2)
- sonner (existente, Slice 2)
- Hand-typed types (back tiene gap de openapi — mismo patrón que Slice 2)
- **Sin nuevas dependencias** en el `package.json`

## Riesgos conocidos

1. **Contar certificados esta semana** depende de que `GET /api/certificates` esté deployed con `issue_date_from/to`. Confirmado en `certificates.dto.ts:33-34`. Si falla en producción, degradamos esa card a "—" sin romper el resto.
2. **El back guarda `row_number` virtual en `import_errors`** (no Excel row real) — bug conocido del Slice 2, no afecta Stock pero quedará TODO de UX para mostrar "fila X" precisa cuando agreguemos detail view.
3. **Volumen del dropdown de comercios** ~470 hoy. Estable hasta los 1k. Si crece más rápido de lo esperado, el dropdown nativo se vuelve UX pobre — mover a `cmdk` es 1 PR aparte.
