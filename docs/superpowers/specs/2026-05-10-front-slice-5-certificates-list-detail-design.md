# Frontend Slice 5 — `/certificates` list + detail + cancel Design Spec

**Fecha:** 2026-05-10
**Estado:** Aprobado, listo para implementation plan
**Repo afectado:** `araguaney_front` (Slice 4 wizard ya en producción)
**Repo dependiente:** `araguaney_back` con `/api/certificates*` desplegado en Railway

---

## Goal

Cerrar el loop "crear → ver → cancelar" para certificados bursátiles. El operador de Tesorería puede listar los certificados emitidos, abrir el detail de uno con su pool de órdenes y trazabilidad, y cancelarlo cuando proceda (sale del proceso de emisión, las órdenes vuelven al stock disponible).

Slice 4 dejó el wizard de creación funcionando pero sin manera de ver los certificados emitidos. Hoy el operador emite y queda a ciegas. Slice 5 lo destraba.

## Non-Goals (YAGNI)

- **Tabs Cuotas / Calendario de pagos / Comercios** del detail — la data ya está embebida en `/api/certificates/:id` (orders[].installments, concentración) pero el operador típicamente no necesita verla cuota-por-cuota. Si Tesorería lo pide, slice aparte.
- **Botones "Exportar Excel" / "Descargar PDF" / "Liberar al vencimiento"** del mockup — no hay endpoints en el back. La descarga formal del CFB (PDF para SUNAVAL) será un slice dedicado cuando exista el doc.
- **Filtro `include_deleted`** — toggle de admin que muestra certificados borrados. YAGNI hasta que un admin lo pida.
- **Filtro por `certificate_type` (Standard / Sweep)** — el sweep tiene su propio flujo. Listar mezclado complica la UX sin valor real.
- **URL legible por code** (`/certificates/C4572A`) — requiere agregar lookup por code al back. Usamos `/certificates/{uuid}` que es feo pero funcional (el operador siempre llega desde la lista, nunca tipea la URL).
- **Auto-refresh / polling** del detail después de cancel — el invalidate queries del mutation lo cubre.
- **Bulk cancel** — un cancel a la vez.
- **Editar reason después de cancel** — la cancelación es inmutable.
- **Comparar dos certificados** — fuera de scope.
- **Histórico completo de events** — solo los últimos N (≤10) en el sidebar.

## Decisiones cerradas (Q&A brainstorm)

| Q | Decisión | Razón |
|---|---|---|
| Alcance Slice 5 | List + Detail + Cancel | Cierra el loop completo; mockup del detail ya existe |
| Filtros listado | Status (pills) · Inversor (dropdown) · Fecha emisión rango · Búsqueda por código | Los 4 que cubren las preguntas reales del operador |
| Detail tabs | Solo Órdenes | Cuotas/Calendario/Comercios = YAGNI; data embebida queda accesible vía API si después se necesita |
| Detail layout | Header + Hero strip (5 cards) + Body 2-col (orders table + sidebar) | Match con mockup `42adf699` con elementos no-implementables removidos |
| Detail URL | `/certificates/{uuid}` | Back's `:id` valida UUID; agregar lookup por code = nuevo endpoint del back |
| Cancel UX | Modal con textarea reason (5-1000 chars) → POST → close + toast + invalidate | Safety: cancel es alto riesgo |
| Cancel post-success | Detail page se queda en pantalla con status='cancelled' visible | No redirect; transparencia sobre lo que pasó |
| Sidebar audit | Top 10 events más recientes embebidos en `/api/certificates/:id`'s `events` | Suficiente para diagnóstico; histórico completo es slice aparte |
| Type correction | Renombrar `Certificate` (Slice 4) a usar `certificate_code`, `investor_capital`, `annual_rate` | Bug de Slice 4: tipos no matcheaban wire shape; Slice 5 lo arregla en Task 1 |

## Hallazgos del back (relevantes)

### `GET /api/certificates`

Permission: `certificate.read`. Query schema:

```ts
{
  limit?: number,
  offset?: number,
  status?: 'draft' | 'issued' | 'matured' | 'cancelled',
  certificate_type?: 'standard' | 'sweep',     // no usado en Slice 5
  investor_id?: string (uuid),
  issue_date_from?: string (ISO date),
  issue_date_to?: string (ISO date),
  q?: string,                                   // substring en certificate_code
  sort?: 'issue_date_desc' | 'issue_date_asc' | 'code_asc',
  include_deleted?: boolean,                    // no usado en Slice 5
}
```

Response: `{ data: CertificateSummary[]; total; limit; offset }`.

### `CertificateSummary` (response shape — wire-accurate)

```ts
type CertificateSummary = {
  id: string;
  certificate_code: string;                     // e.g. "C4572A"
  certificate_type: 'standard' | 'sweep';
  status: 'draft' | 'issued' | 'matured' | 'cancelled';
  investor: { id: string; legal_name: string; rif: string };
  investor_capital: string;                     // Decimal as string, e.g. "100000.0000"
  annual_rate: string;                          // e.g. "0.130000"
  term_days: 14 | 42;
  price: string;
  nominal_target: string;
  nominal_actual: string;
  investor_paid: string;
  investor_yield: string;
  shortfall_pct: string;
  issue_date: string;                           // ISO date
  maturity_date: string;
  cycle_week: string;                           // e.g. "2026-W18"
  issued_by: { id: string; email: string; full_name: string };
  created_at: string;                           // ISO timestamp
};
```

### `GET /api/certificates/:id` (detail)

Permission: `certificate.read`. Response = `CertificateSummary` + extras:

```ts
type CertificateDetail = CertificateSummary & {
  investor_returned: string;
  payload_hash: string;
  cancellation: {
    cancelled_at: string;
    cancelled_by: { id: string; email: string; full_name: string } | null;
    reason: string | null;
  } | null;
  orders: Array<{
    id: string;
    external_order_id: string;
    merchant: { id: string; current_name: string; rif: string };
    purchase_date: string;
    max_due_date: string;
    installments_sum_snapshot: string;
    assigned_at: string;
    installments: Array<{
      installment_number: number;
      amount: string;
      due_date: string;
      status: 'pending' | 'paid' | 'overdue' | 'cancelled';
    }>;
  }>;
  events: Array<{
    id: string;
    event_type: string;
    occurred_at: string;
    payload: unknown;
    actor_id: string | null;
  }>;
};
```

`404` si el id no existe o el cert está borrado y el caller no tiene permiso de admin.

### `POST /api/certificates/:id/cancel`

Permission: `certificate.cancel` (operator + admin; auditor NO). Body:

```ts
{ reason: string }   // min 5, max 1000 chars
```

Response: el `Certificate` actualizado con `status='cancelled'` y `cancellation` poblado.

Errores posibles:
- `400` "Solo se puede cancelar un certificado 'issued'" (si ya está cancelled o matured)
- `404` "Certificado no encontrado"
- `400` validation error sobre reason

### Type correction de Slice 4

El `Certificate` interface de Slice 4 (lib/types/certificate.ts) usa nombres equivocados:

| Slice 4 (incorrecto) | Back wire (correcto) |
|---|---|
| `code` | `certificate_code` |
| `capital` | `investor_capital` |
| `rate` | `annual_rate` |
| `num_orders` | (no existe; derivar de orders.length) |
| `issued_at` | (no existe; usar `created_at`) |

Consecuencia actual en producción: `step3-confirm.tsx` hace `toast.success(\`Certificado \${cert.code} emitido\`)` → "Certificado undefined emitido". Slice 5 Task 1 corrige los tipos y Task X actualiza el toast a usar `cert.certificate_code`.

---

## Architecture

```
/certificates                       (Server Component shell, dynamic = 'force-dynamic')
  └─ <CertificatesPage> (Client)
       ├─ <PageHeader breadcrumb="Operación · Certificados" />
       ├─ <CertificateFilters>
       │    ├─ Status pills (Activos default · Todos · Vencidos · Cancelados)
       │    ├─ Inversor <select> (useQuery ['investors'])
       │    ├─ Date range (desde / hasta)
       │    └─ Search por código (debounced 300ms)
       └─ <CertificatesTable>
            ├─ useQuery(['certificates', filters, page]) → listCertificates(...)
            ├─ <CertificateRow cert={...} />
            │    └─ <CertificateStatusPill status={...} />
            └─ pagination footer

/certificates/[id]                  (Server Component shell)
  └─ <CertificateDetailPage> (Client)
       ├─ <CertHeader>
       │    ├─ Breadcrumb Operación · Certificados · {code}
       │    ├─ Title (investor.legal_name) + code pill + status pill
       │    ├─ Subtitle "Emitido {date} por {full_name} · {rif}"
       │    └─ [Cancelar certificado] button (gated on certificate.cancel + status==='issued')
       ├─ <CertHeroStrip>
       │    └─ 5 cards: Capital · Tasa · Plazo · Composición · Estado
       ├─ Body grid 1fr 320px:
       │    ├─ <CertOrdersTable>
       │    │    ├─ Filter input (substring on order code / merchant)
       │    │    ├─ <CertOrderRow>
       │    │    └─ Footer totals
       │    └─ <CertAuditSidebar>
       │         ├─ Investor info block (KV rows)
       │         ├─ Reglas verificadas (3 ✓)
       │         └─ Audit events timeline (top 10)
       └─ {cancelOpen && <CancelCertModal cert={...} onClose />}
            └─ textarea reason + Confirmar/Cancelar
                 └─ useMutation → cancelCertificate(id, reason)
                      onSuccess: invalidate + toast + close
```

Mismo patrón que slices anteriores. Server component shell delgado, client orquestador hace todo.

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `lib/types/certificate.ts` | modify | Corregir `Certificate` (usar wire shape: `certificate_code`, `investor_capital`, `annual_rate`); add `CertificateSummary`, `CertificateDetail`, `CertificateOrder`, `CertificateEvent`, `Cancellation` |
| `lib/api/certificates.ts` | modify | Add `listCertificates`, `getCertificateDetail`, `cancelCertificate`. Mantener `simulateCertificate`, `issueCertificate`, `countCertificatesIssued`. Update issue return type |
| `lib/api/certificates.test.ts` | modify | Add tests for the 3 new functions |
| `lib/format/cycle-day.ts` | create | `daysSince(iso)` → "día N de M" para el hero strip status card |
| `lib/format/cycle-day.test.ts` | create | Tests |
| `components/certificates/certificates-page.tsx` | create | Orquestador del listado |
| `components/certificates/certificates-page.test.tsx` | create | Smoke integrado |
| `components/certificates/certificate-filters.tsx` | create | Status pills + inversor + fechas + search |
| `components/certificates/certificate-filters.test.tsx` | create | Tests |
| `components/certificates/certificates-table.tsx` | create | useQuery + table + paginación |
| `components/certificates/certificates-table.test.tsx` | create | Tests |
| `components/certificates/certificate-row.tsx` | create | Single row, click → router.push |
| `components/certificates/certificate-row.test.tsx` | create | Tests |
| `components/certificates/certificate-status-pill.tsx` | create | Pill wrapper para CertificateStatus |
| `components/certificates/certificate-status-pill.test.tsx` | create | One assertion per status |
| `components/certificates/certificate-detail-page.tsx` | create | Orquestador del detail |
| `components/certificates/certificate-detail-page.test.tsx` | create | Smoke integrado |
| `components/certificates/cert-header.tsx` | create | Breadcrumb + title + subtitle + Cancelar button |
| `components/certificates/cert-header.test.tsx` | create | Tests (incluye gating del botón) |
| `components/certificates/cert-hero-strip.tsx` | create | 5 stat cards |
| `components/certificates/cert-hero-strip.test.tsx` | create | Tests |
| `components/certificates/cert-orders-table.tsx` | create | Tabla de órdenes del pool + filter |
| `components/certificates/cert-orders-table.test.tsx` | create | Tests |
| `components/certificates/cert-audit-sidebar.tsx` | create | Investor info + reglas + audit timeline |
| `components/certificates/cert-audit-sidebar.test.tsx` | create | Tests |
| `components/certificates/cancel-cert-modal.tsx` | create | Modal con textarea reason + mutation |
| `components/certificates/cancel-cert-modal.test.tsx` | create | Tests (incl. validación de reason length) |
| `app/(app)/certificates/page.tsx` | modify | Replace ComingSoon stub con `<CertificatesPage />` |
| `app/(app)/certificates/[id]/page.tsx` | create | Server shell con `<CertificateDetailPage id={params.id} />` |
| `components/cert-wizard/step3-confirm.tsx` | modify | Update toast `cert.code` → `cert.certificate_code` (bugfix de Slice 4) |
| `components/cert-wizard/step3-confirm.test.tsx` | modify | Update mock return + assertion |
| `lib/permissions/has-permission.ts` | modify | Add `certificate.cancel` (operator + admin; auditor NO) |
| `lib/permissions/has-permission.test.ts` | modify | Tests del nuevo permiso |

Total: 27 archivos nuevos + 6 modificados. ~75 tests nuevos.

---

## UI Spec

### Lista layout

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ Operación · Certificados                                                      │
│ Certificados                                                                  │
│                                                                               │
│ [Activos] Todos Vencidos Cancelados                       [🔎 Código]        │
│ [Inversor ▾]   [Emitido desde: 📅]   [hasta: 📅]                              │
├───────────────────────────────────────────────────────────────────────────────┤
│ CÓDIGO  │ INVERSOR              │ EMITIDO    │ VENCE      │ CAPITAL  │ ESTADO│
│ C4572A  │ Inversora Alpha, C.A. │ 27/04/2026 │ 08/06/2026 │ $100,000 │ Activo│
│ C4571A  │ Fondo Mutual Caracas  │ 20/04/2026 │ 04/05/2026 │ $250,000 │ Activo│
│ ...                                                                           │
│ Mostrando 1–50 de 12                                              ←   →       │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Status pills options:**

```ts
const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'issued',    label: 'Activos' },     // default
  { value: 'all',        label: 'Todos' },
  { value: 'matured',   label: 'Vencidos' },
  { value: 'cancelled', label: 'Cancelados' },
];
```

**Default state:** `status='issued'`, `investorId=null`, `dateFrom=null`, `dateTo=null`, `q=''`.

**Row click** → `router.push(`/certificates/${cert.id}`)`. Hover state highlights the row.

**Status pill colors:**

```ts
const PILL_MAP: Record<CertificateStatus, { variant: PillVariant; label: string }> = {
  draft:     { variant: 'neutral', label: 'Borrador' },
  issued:    { variant: 'success', label: 'Activo' },
  matured:   { variant: 'info',    label: 'Vencido' },
  cancelled: { variant: 'danger',  label: 'Cancelado' },
};
```

### Detail layout

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ Operación · Certificados · C4572A                              [Cancelar cert]│
│ Inversora Alpha, C.A.  [C4572A]  ● Activo                                     │
│ Emitido 27/04/2026 por María Rodríguez · J-12345678-9                         │
├───────────────────────────────────────────────────────────────────────────────┤
│ CAPITAL       TASA          PLAZO         COMPOSICIÓN     ESTADO              │
│ $100,000.00   13.0%         42d           343 órdenes     ● Activo            │
│ residual $0   $1,540 yld    vence 08/06   71 comercios    día 12 de 42        │
├───────────────────────────────────────────────────────────────────────────────┤
│ ┌─ Órdenes (343) ─────────────────────────────────────┐ ┌─ INVERSOR ────────┐ │
│ │ [🔎 ID o comercio]                                  │ │ Razón social      │ │
│ │ ID         │ COMERCIO          │ CUOTAS │ MONTO     │ │ Inversora Alpha   │ │
│ │ 85657474   │ CENTRAL MADEIR.   │ 3      │ $87.24    │ │ RIF J-12345678-9  │ │
│ │ 85656105   │ GRUPO CANALETTO   │ 1      │ $26.07    │ ├───────────────────┤ │
│ │ ...                                                 │ │ REGLAS VERIFICADAS│ │
│ │ Mostrando 1–50 de 343                  ← →          │ │ Venc ≤ cert    ✓  │ │
│ │ Total del pool: $100,000 · 343 órdenes · 889 cuotas │ │ Indivisibles   ✓  │ │
│ └─────────────────────────────────────────────────────┘ │ Capital sum    ✓  │ │
│                                                          ├───────────────────┤ │
│                                                          │ AUDITORÍA         │ │
│                                                          │ ● María Rodríguez │ │
│                                                          │   emitió hace 5d  │ │
│                                                          │ ● María Rodríguez │ │
│                                                          │   simuló hace 5d  │ │
│                                                          └───────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────┘
```

### Hero strip cards (5 columns)

```
CAPITAL                  TASA                  PLAZO                COMPOSICIÓN           ESTADO
{investor_capital}       {annual_rate as %}    {term_days}d         {orders.length}        ● {status label}
residual {refund}        {yield} al vencim.    vence {maturity}     {distinct merchants}   día {N} de {term_days}
                                                                     comercios
```

- **Capital**: `investor_capital` (fmtMoney2) + sub "residual {investor_returned}" (devolución cash inicial)
- **Tasa**: `annual_rate * 100` % + sub "{investor_yield} al vencimiento"
- **Plazo**: `term_days`d + sub "vence {maturity_date}"
- **Composición**: orders.length + sub "{N} comercios"
- **Estado**: pill verde/gris/rojo según status + sub "día {N} de {term_days}" o "{N}d para vencer" o "cancelado {date}"

Para `daysSince(issue_date)`: helper `lib/format/cycle-day.ts`.

### Cancel modal layout

```
┌──────────────────────────────────────────────────┐
│ Cancelar certificado C4572A                    × │
├──────────────────────────────────────────────────┤
│ Esta acción NO puede deshacerse.                 │
│ Las 343 órdenes vuelven a estado 'disponible'.   │
│                                                  │
│ Motivo de la cancelación (requerido):           │
│ ┌────────────────────────────────────────────┐  │
│ │ {textarea}                                 │  │
│ │                                            │  │
│ └────────────────────────────────────────────┘  │
│ {N} / 1000 caracteres · mínimo 5                 │
├──────────────────────────────────────────────────┤
│                  [Cancelar] [Confirmar cancelac.]│
└──────────────────────────────────────────────────┘
```

- `[Confirmar cancelación]` deshabilitado si `reason.length < 5` o `> 1000`.
- Loading state durante mutation: button dice "Cancelando…", todos disabled.
- onSuccess: invalidate `['certificates']` + `['certificate', id]` + toast "Certificado {code} cancelado" + cierra modal.
- onError: toast con el mensaje del back, modal queda abierto.

---

## Data Fetching

### Server Actions (extender `lib/api/certificates.ts`)

```ts
'use server';

// Existing: simulateCertificate, issueCertificate, countCertificatesIssued
// New:
export async function listCertificates(query: ListCertificatesQuery): Promise<CertificatesListResponse>;
export async function getCertificateDetail(id: string): Promise<CertificateDetail>;
export async function cancelCertificate(id: string, reason: string): Promise<CertificateDetail>;
```

Patrón `rethrowWithMessage` igual que el resto.

### TanStack queries

```ts
// Lista
const certs = useQuery({
  queryKey: ['certificates', filters, page],
  queryFn: () => listCertificates({ ...buildQuery(filters), limit: 50, offset: page * 50 }),
  staleTime: 30 * 1000,
  refetchOnWindowFocus: true,
  placeholderData: (prev) => prev,
});

// Investors dropdown — reuse listInvestors (Slice 4)
const investors = useQuery({
  queryKey: ['investors'],
  queryFn: () => listInvestors({ limit: 200, kind: 'juridica', status: 'active', sort: 'name_asc' }),
  staleTime: 10 * 60 * 1000,
});

// Detail
const detail = useQuery({
  queryKey: ['certificate', id],
  queryFn: () => getCertificateDetail(id),
  staleTime: 30 * 1000,
});

// Cancel mutation
const cancelMut = useMutation({
  mutationFn: ({ id, reason }) => cancelCertificate(id, reason),
  onSuccess: (cert) => {
    qc.invalidateQueries({ queryKey: ['certificate', id] });
    qc.invalidateQueries({ queryKey: ['certificates'] });
    qc.invalidateQueries({ queryKey: ['orders'] });          // las órdenes vuelven a disponible
    qc.invalidateQueries({ queryKey: ['orders-stats'] });
    toast.success(`Certificado ${cert.certificate_code} cancelado`);
    onClose();
  },
  onError: (err) => {
    toast.error(err instanceof Error ? err.message : 'Error al cancelar');
  },
});
```

---

## Error Handling

| Situación | UX |
|---|---|
| 401 | Layout protegido redirige a `/auth/clear` |
| 403 listar (sin `certificate.read`) | Empty state "Sin permiso" en lugar de tabla |
| 403 detail | Empty state similar |
| 404 detail (id inválido/borrado) | Empty state "Certificado no encontrado" + link al listado |
| 5xx en list | Empty state + botón Reintentar |
| 5xx en detail | Empty state + botón Reintentar |
| 400 cancel "ya no es issued" | Toast rojo con mensaje del back, modal queda abierta, usuario puede cerrar |
| 403 cancel (auditor) | Botón Cancelar no aparece (gating client-side) |
| 5xx cancel | Toast rojo, modal queda abierta |
| Network error | Toast genérico, retry |

---

## Permissions

- `certificate.read` — listar y ver detail (operator + admin + auditor todos lo tienen seedeados)
- `certificate.cancel` — botón Cancelar (operator + admin; auditor NO)

Si el usuario es auditor:
- Ve la lista y el detail
- NO ve el botón Cancelar
- Si intenta forzar la mutation (vía DevTools), el back tira 403 → toast con mensaje

---

## Testing

| Archivo | Tipo | Tests aprox |
|---|---|---|
| `lib/api/certificates.test.ts` | unit (extension) | +6 (list + detail + cancel happy + cancel 400/5xx + filter query string) |
| `lib/format/cycle-day.test.ts` | unit | 4 (today / same day / N days / edge) |
| `lib/permissions/has-permission.test.ts` | unit (extension) | +2 (operator/admin yes, auditor no for certificate.cancel) |
| `lib/types/certificate.ts` (no test, just types) | — | — |
| `components/certificates/certificate-status-pill.test.tsx` | unit | 4 (one per status) |
| `components/certificates/certificate-row.test.tsx` | unit | 3 (render / click navigation / cancelled formatting) |
| `components/certificates/certificate-filters.test.tsx` | unit | 5 (status default / investor / date / search debounce / clear) |
| `components/certificates/certificates-table.test.tsx` | unit | 6 (loading / empty / error / data / pagination / status=all → undefined param) |
| `components/certificates/certificates-page.test.tsx` | smoke | 2 (full render / filter change re-keys) |
| `components/certificates/cert-header.test.tsx` | unit | 5 (render / breadcrumb / cancel button visible operator+issued / hidden auditor / hidden non-issued) |
| `components/certificates/cert-hero-strip.test.tsx` | unit | 5 (5 cards rendered / status active / status matured / status cancelled / day counter) |
| `components/certificates/cert-orders-table.test.tsx` | unit | 5 (loading / empty pool / data / search filter / footer totals) |
| `components/certificates/cert-audit-sidebar.test.tsx` | unit | 4 (investor info / rules ✓ / events render / events empty) |
| `components/certificates/cancel-cert-modal.test.tsx` | unit | 6 (render / disabled when <5 chars / enabled / submit success / submit error / character counter) |
| `components/certificates/certificate-detail-page.test.tsx` | smoke | 3 (full render / cancel flow happy / cancel error |
| `components/cert-wizard/step3-confirm.test.tsx` | unit (modify) | adjust mock to use `certificate_code` |

Total: ~62 tests nuevos.

Mismo setup que slices previas: vitest + RTL + jsdom. `renderWithQuery` existe.

---

## Smoke Plan (manual, post-deploy)

1. Login como `operator`.
2. Subir un lote → /stock → "+ Nuevo certificado" → emit one with capital $50,000 / 13% / 42d. Confirmar toast verde con código real (no "undefined").
3. Navegar a `/certificates`. Ver la fila del recién emitido. Status "Activo".
4. Click filter "Cancelados" → tabla vacía. Volver a "Activos" → fila visible.
5. Buscar por las primeras letras del código → tabla filtra.
6. Click la fila → navega a `/certificates/{id}`.
7. Verificar hero strip muestra capital, tasa, plazo, composición, estado. Sidebar muestra inversor y reglas ✓. Audit timeline muestra al menos 1 event "emitido".
8. Tabla de órdenes muestra las del pool (>0 órdenes), con merchant + cuotas + monto.
9. Click "Cancelar certificado" → modal abre.
10. Escribir reason corto (<5 chars) → botón disabled.
11. Escribir reason válido → click Confirmar → modal cierra, toast verde, detail re-renderiza con pill "Cancelado" y botón Cancelar desaparece.
12. Volver a /stock → órdenes del pool ahora aparecen como "Disponibles" otra vez.
13. Login como `auditor`. Repetir 3-7. Detail accesible. NO ve botón Cancelar.

---

## Out of Scope (recordatorio)

| | |
|---|---|
| Tabs Cuotas / Calendario / Comercios en detail | Slice aparte si Tesorería lo pide |
| Exportar Excel / PDF / Liberar al vencimiento | No hay endpoints en el back |
| URL legible (`/certificates/C4572A`) | Requiere nuevo lookup en el back |
| Filtro `include_deleted` | YAGNI |
| Bulk cancel | YAGNI |
| Edit reason post-cancel | Cancelación inmutable |
| Compare 2 certs side-by-side | YAGNI |

---

## Dependencias

- TanStack Query v5 (existente)
- shadcn `<Pill>` + sonner (existentes)
- Hand-typed shapes — back tiene gaps de openapi
- **Sin nuevas dependencias** en `package.json`

## Riesgos conocidos

1. **Type correction de Slice 4**: cambiar `Certificate.code` → `Certificate.certificate_code` en Task 1 puede romper el wizard's Step3 silenciosamente si me olvido de actualizar la línea del toast. Tarea explícita en el plan para evitarlo.
2. **Cancel race condition**: si el operador y otro user cancelan al mismo tiempo, el segundo recibe 400. El front muestra el error del back; aceptable.
3. **Detail con muchas órdenes (>500)**: la tabla renderiza todas porque vienen embebidas en `/api/certificates/:id` (no paginadas server-side). Para certificados grandes podría haber lag. Por ahora ≤50/página client-side; si supera 1k orders la performance puede sufrir. Slice aparte si hace falta paginar las orders en el back.
4. **Audit events sin filtro**: el back devuelve los últimos N (no documentado el cap). El sidebar puede crecer feo si hay >20 events. Mostramos top 10 con scroll si excede.
