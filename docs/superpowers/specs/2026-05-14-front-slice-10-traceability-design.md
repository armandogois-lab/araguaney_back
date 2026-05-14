# araguaney_front Slice 10 — `/traceability` Reporte de trazabilidad

**Date:** 2026-05-14
**Status:** Draft for implementation
**Spec for:** `araguaney_front`
**Prior slices:** 1-9 merged. Permission gating already in place from Slice 8 nav fix (admin + auditor see `/traceability` in the sidebar).

## Goal

Ship `/traceability` — a chain view of certificates with their orders for SUNAVAL/compliance audit needs. Each row in the page is a certificate; expand it and you see its constituent orders; click an order and a side inspector shows the full audit chain (Orden → Lote → Certificado → Inversor → Emitido por) plus the cert's `payload_hash`. Removes the Slice 1 ComingSoon stub.

## Scope (in)

- Route `/traceability` (chain view only — flat table is out of scope).
- Top toolbar: search input (debounced 300 ms) + 2 date inputs (Desde / Hasta).
- Default period: last 30 days. User can change via the date inputs.
- 3 KPI cards above the toolbar: Certificados emitidos, Inversores con cobertura, Usuarios emisores.
- Chain list: certs ordered `issue_date_desc`, expandable. Multi-cert expansion allowed.
- Each card: cert header row + (when expanded) order rows with tree connectors.
- Inspector panel: sticky right column when an order is selected. 5 vertical steps + SHA hash.
- Permission: visible to admin + auditor (sidebar gate; no page-level gate).

## Scope (out)

- **Flat-table view** — the mockup has it but it requires fetching all cert details upfront. Defer to a future slice when the back exposes a flattened `/api/traceability` endpoint.
- **Export Excel / PDF** — separate slices.
- **Order-level search** — search filters at cert level (code, investor name/RIF, issued_by name). Order-level matching (order id / merchant) requires expanded details we don't fetch eagerly. A future enhancement can prefetch details when a query is active.
- **Period KPI card** (mockup has 4 cards; we ship 3) — the date picker already shows the range; a separate KPI is redundant.
- **Batch metadata in inspector** ("Subido el ... · N órdenes") — the order only carries `batch_id`. Showing batch date/order-count would require an extra fetch per order click. v1 shows `Lote {batch_id_short}` without the sub-line.
- **`pulse-dot` animations / fancy chain SVG** — keep CSS simple. Use plain dots + 1px connector lines.
- **Page-level error toast** — relies on the per-section error states (same pattern as `/cycle`).

## Architecture

```
app/(app)/traceability/page.tsx (server shell)
  └── <TraceabilityPage> (client orchestrator)
        ├── PageHeader (breadcrumb: Sistema · Trazabilidad)
        ├── <TraceKpiStrip> (computed from cert list)
        ├── <TraceToolbar> (search + date range)
        └── grid 2-col (full-width vs [1fr_340px] when selectedOrder)
              ├── list of <TraceCertCard>
              │     ├── <TraceCertRow>           ← always renders
              │     └── <TraceCertOrders>        ← mounts only when expanded
              └── <TraceInspector>               ← when selectedOrder !== null
```

**State** in `<TraceabilityPage>`:

```ts
const [filters, setFilters] = useState<TraceFiltersValue>(initialFilters);
const [expanded, setExpanded] = useState<Set<string>>(new Set());
const [selectedOrder, setSelectedOrder] = useState<
  { order: CertificateOrder; cert: CertificateSummary } | null
>(null);
```

## Data sources (existing back endpoints)

| Endpoint | Use | Slice |
|---|---|---|
| `GET /api/certificates?issue_date_from&to&sort=issue_date_desc&limit=100` | Top-level cert list | Slice 5 — `listCertificates` |
| `GET /api/certificates/:id` | Per-cert detail (orders embedded) — fetched lazily when card expands | Slice 5 — `getCertificateDetail` |

No new back endpoints. Permission `certificate.read` is universal; no extra back work.

## Search filter helper

New module: `lib/traceability/filter.ts`.

```ts
import type { CertificateSummary } from '@/lib/types/certificate';

export type FilterMatchMode = 'all' | 'match-cert';

export interface FilteredCert {
  cert: CertificateSummary;
  mode: FilterMatchMode;
}

export function filterCertsBySearch(
  certs: CertificateSummary[],
  query: string,
): FilteredCert[] {
  const q = query.trim().toLowerCase();
  if (!q) return certs.map((cert) => ({ cert, mode: 'all' }));
  const out: FilteredCert[] = [];
  for (const cert of certs) {
    const hay = [
      cert.certificate_code,
      cert.investor.legal_name,
      cert.investor.rif,
      cert.issued_by.full_name,
    ]
      .join(' ')
      .toLowerCase();
    if (hay.includes(q)) out.push({ cert, mode: 'match-cert' });
  }
  return out;
}
```

Pure function, testable independently. Order-level matching is out of scope for v1; the `'match-cert'` mode is currently identical to `'all'` in behavior but keeps the type future-proof for when order-level matching arrives.

## Components

### `<TraceKpiStrip>`

Props: `certsQ: UseQueryResult<CertificatesListResponse>`.

3 cards in a `grid grid-cols-3`:

1. **Certificados emitidos** — value `certsQ.data.total`. Sub: `en el período`.
2. **Inversores con cobertura** — value `new Set(certs.map(c => c.investor.id)).size`. Sub: `únicos con orden asignada`.
3. **Usuarios emisores** — value `new Set(certs.map(c => c.issued_by.full_name)).size`. Sub: first 2 names joined with " · ", truncated if more.

Each card has its own skeleton/error state. 3 tests.

### `<TraceToolbar>`

Props: `value: TraceFiltersValue`, `onChange: (next) => void`.

```ts
export interface TraceFiltersValue {
  q: string;
  dateFrom: string;
  dateTo: string;
}
```

- Search input (placeholder: "Buscar por código, inversor, RIF o usuario emisor…"), 300ms debounce (same pattern as `<CertificateFilters>`).
- Date inputs labeled "Desde" / "Hasta" with `aria-label`.

4 tests.

### `<TraceCertRow>`

Props: `cert: CertificateSummary`, `expanded: boolean`, `onToggle: (certId: string) => void`.

Single clickable row laid out as `grid-cols-[18px_1.2fr_1.6fr_1fr_1fr_100px]`:

1. Chevron (▸ rotated 90° when expanded)
2. `certificate_code` (mono) + sub `{orders_count} órdenes · ${capital} · ${term}d @ {rate}%` (no `orders_count` on summary; sub becomes `${capital} · ${term}d @ ${rate}%` — drop the count for v1)
3. Inversor: legal_name + RIF mono
4. Emitido por: full_name + fmtDate
5. Vencimiento: fmtDate
6. Status pill (reuse `<CertificateStatusPill>`; sweep certs get `<Pill variant="sweep">`)

3 tests.

### `<TraceCertOrders>`

Props: `cert: CertificateSummary`, `enabled: boolean`, `onSelectOrder: (order, cert) => void`.

```ts
const detailQ = useQuery({
  queryKey: ['certificate', cert.id],
  queryFn: () => getCertificateDetail(cert.id),
  staleTime: 30_000,
  enabled,
});
```

- When `enabled=false` → return `null` (no fetch).
- When `enabled=true` + loading → "Cargando órdenes…" centered.
- When error → "No se pudieron cargar las órdenes." with retry (`detailQ.refetch`).
- When data → render up to 10 orders + footer "… N órdenes más en este certificado" when `total - 10 > 0`.

Each order row is a grid `grid-cols-[1fr_1.6fr_60px_100px_90px]`:
1. `external_order_id` (mono)
2. `merchant.current_name` (truncated)
3. Cuotas pill (`{installments.length}c`)
4. `Lote {batch_id.slice(0, 8)}` (mono, truncated — we don't have batch external_code here)
5. `installments_sum_snapshot` formatted as money

Tree connector lines (1px gray) drawn with absolute-positioned divs as the mockup. 4 tests.

### `<TraceCertCard>`

Wraps `<TraceCertRow>` + (conditional) `<TraceCertOrders>`. Manages no state itself — receives `expanded` + `onToggle` from parent.

```tsx
<div className="bg-card border-border-subtle overflow-hidden rounded-xl border">
  <TraceCertRow cert={cert} expanded={expanded} onToggle={onToggle} />
  <TraceCertOrders cert={cert} enabled={expanded} onSelectOrder={onSelectOrder} />
</div>
```

2 tests (smoke + toggle-expand observable).

### `<TraceInspector>`

Props: `order: CertificateOrder`, `cert: CertificateSummary`, `payloadHash: string | null`, `onClose: () => void`.

Sticky-positioned panel (the parent grid handles layout). Vertical chain with 5 steps:

```
●  ORDEN
   {merchant.current_name}
   {merchant.rif} · {installments.length} cuotas · ${installments_sum_snapshot}

●  LOTE
   Lote {batch_id.slice(0, 8)}

●  CERTIFICADO
   {certificate_code}
   Emitido {fmtDate(issue_date)} · {term_days}d @ {fmtPct(annual_rate)}

●  INVERSOR
   {investor.legal_name}
   {investor.rif}

●  EMITIDO POR
   {issued_by.full_name}
   Tesorería · usuario emisor
```

The last step's dot is filled (mockup: `background: '#0A0A0A'`); the rest are outlined.

Footer: `HASH · {payloadHash.slice(0, 8)}…{payloadHash.slice(-4)}` in mono. If `payloadHash` is empty/null → `HASH · —`.

Click × → `onClose()`. 4 tests.

### `<TraceabilityPage>` orchestrator

```tsx
'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/layout/page-header';
import { listCertificates } from '@/lib/api/certificates';
import { filterCertsBySearch } from '@/lib/traceability/filter';
import type { CertificateSummary, CertificateOrder } from '@/lib/types/certificate';
import { TraceKpiStrip } from './trace-kpi-strip';
import { TraceToolbar, type TraceFiltersValue } from './trace-toolbar';
import { TraceCertCard } from './trace-cert-card';
import { TraceInspector } from './trace-inspector';

function defaultFilters(): TraceFiltersValue {
  const today = new Date();
  const thirty = new Date();
  thirty.setDate(thirty.getDate() - 30);
  return {
    q: '',
    dateFrom: thirty.toISOString().slice(0, 10),
    dateTo: today.toISOString().slice(0, 10),
  };
}

export function TraceabilityPage() {
  const initial = useMemo(defaultFilters, []);
  const [filters, setFilters] = useState<TraceFiltersValue>(initial);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<
    { order: CertificateOrder; cert: CertificateSummary } | null
  >(null);

  const certsQ = useQuery({
    queryKey: [
      'certificates',
      {
        issue_date_from: filters.dateFrom,
        issue_date_to: filters.dateTo,
        sort: 'issue_date_desc',
        limit: 100,
      },
    ],
    queryFn: () =>
      listCertificates({
        issue_date_from: filters.dateFrom,
        issue_date_to: filters.dateTo,
        sort: 'issue_date_desc',
        limit: 100,
      }),
    staleTime: 60_000,
  });

  const visible = filterCertsBySearch(certsQ.data?.data ?? [], filters.q);

  function toggleExpand(certId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(certId)) next.delete(certId);
      else next.add(certId);
      return next;
    });
  }

  const hasInspector = selected !== null;

  return (
    <div className="mx-auto w-full max-w-[1440px] px-9 py-7">
      <PageHeader
        breadcrumb={{ section: 'Sistema', current: 'Trazabilidad' }}
        title="Reporte de trazabilidad"
      />
      <div className="mt-5 flex flex-col gap-4">
        <TraceKpiStrip certsQ={certsQ} />
        <TraceToolbar value={filters} onChange={setFilters} />
        <div
          className={
            hasInspector ? 'grid gap-4 lg:grid-cols-[1fr_340px]' : 'flex flex-col gap-3'
          }
        >
          <div className="flex flex-col gap-3">
            {certsQ.isLoading && <CenteredCard>Cargando certificados…</CenteredCard>}
            {certsQ.isError && (
              <CenteredCard>
                No se pudieron cargar los certificados.
              </CenteredCard>
            )}
            {!certsQ.isLoading && !certsQ.isError && visible.length === 0 && (
              <CenteredCard italic>Sin certificados en este período.</CenteredCard>
            )}
            {visible.map(({ cert }) => (
              <TraceCertCard
                key={cert.id}
                cert={cert}
                expanded={expanded.has(cert.id)}
                onToggle={toggleExpand}
                onSelectOrder={(order) => setSelected({ order, cert })}
              />
            ))}
          </div>
          {selected && (
            <TraceInspector
              order={selected.order}
              cert={selected.cert}
              payloadHash={null}
              onClose={() => setSelected(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function CenteredCard({ children, italic = false }: { children: React.ReactNode; italic?: boolean }) {
  return (
    <div className="bg-card border-border-subtle flex h-48 items-center justify-center rounded-xl border">
      <div className={'text-text-3 text-center text-sm ' + (italic ? 'italic' : '')}>
        {children}
      </div>
    </div>
  );
}
```

**Note on payload_hash**: `CertificateSummary` doesn't include `payload_hash`; only `CertificateDetail` does. The user can only reach the inspector by clicking an order inside an **expanded** cert card, which means the cert detail has already been fetched and is in the TanStack cache. The inspector reads the hash synchronously via `useQueryClient().getQueryData(['certificate', cert.id])`. If the cache is empty (shouldn't happen given the entry path, but defensive), it renders `HASH · —`.

3 tests.

## File map

| Path | Action |
|---|---|
| `lib/traceability/filter.ts` (+ test) | create |
| `components/traceability/trace-kpi-strip.tsx` (+ test) | create |
| `components/traceability/trace-toolbar.tsx` (+ test) | create |
| `components/traceability/trace-cert-row.tsx` (+ test) | create |
| `components/traceability/trace-cert-orders.tsx` (+ test) | create |
| `components/traceability/trace-cert-card.tsx` (+ test) | create |
| `components/traceability/trace-inspector.tsx` (+ test) | create |
| `components/traceability/traceability-page.tsx` (+ test) | create |
| `app/(app)/traceability/page.tsx` | modify (replace ComingSoon) |

**Total:** 18 new files (9 modules + 9 tests) + 1 modification. ~28 tests.

## Permissions

| Route visibility | operator | admin | auditor |
|---|:---:|:---:|:---:|
| Sidebar item | — | ✓ | ✓ |
| Direct URL access | ✓ (works but no nav link) | ✓ | ✓ |

`certificate.read` is universal; nothing extra needed. Sidebar gate is enough — operator who guesses the URL sees the page work fine.

## Error handling

| Scenario | UI |
|---|---|
| Top-level cert list fails | "No se pudieron cargar los certificados." card; KPIs all show "—"; toolbar still works (user can change dates) |
| Per-cert detail fails (after expansion) | Inside that card only: "No se pudieron cargar las órdenes." + Reintentar; other cards unaffected |
| Empty period | "Sin certificados en este período." italic centered |
| Invalid date range (dateFrom > dateTo) | Whatever the back returns (likely an empty list). No client-side validation; the back is the source of truth. |

## Visual notes

- Cards in the chain list: same `bg-card border-border-subtle rounded-xl border` as other panels.
- Inspector panel: `sticky top-4` so it follows the user's scroll through the long cert list.
- Tree connectors inside expanded body: 1px vertical line on the left + 10px horizontal stub per row, via absolute positioning. Match the mockup's geometry.
- KPI strip: 3 cards (not 4 like the mockup). Reasoning: "Período" KPI duplicates the date picker.

## Out-of-scope follow-ups

1. **Flat-table view** — needs back endpoint to flatten certs + orders efficiently.
2. **Order-level search** — would benefit from query-driven detail prefetch.
3. **Excel / PDF export** — mirror the Slice 7 `exceljs` pattern.
4. **Inspector "Lote" metadata** — needs an extra batch fetch (lazy).
5. **Payload-hash on collapsed cards** — needs the cert summary to include it OR the back to publish a separate hash-summary endpoint.
6. **Highlighting matching orders** when query matches order-level fields (forces expansion).
7. **Cert list pagination** — v1 uses `limit: 100`. Months with >100 certs are silently truncated; the user can narrow the period via the date picker. A future enhancement adds a "Cargar más →" footer.

## Why each choice

| Decision | Rationale |
|---|---|
| Chain view only | Flat view requires bulk-fetching cert details, which is slow for large periods. Defer until back exposes a flattened endpoint. |
| Lazy expand | Cert list is cheap; cert details are heavy. Pay-as-you-go matches the UX of compliance review (browse, expand a few). |
| Default 30-day period | Compliance reviews typically span a month. Bounded query keeps things fast. |
| Multi-cert expansion | Compliance often involves comparing two adjacent certs side-by-side. Single-only would be more constrained. |
| Inspector panel sticky | Long cert lists scroll past the user; inspector should travel with them. |
| 3 KPI cards instead of 4 | Period card is redundant with the date picker UI. |
