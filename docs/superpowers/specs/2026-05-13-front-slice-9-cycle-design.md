# araguaney_front Slice 9 — `/cycle` Panel del ciclo

**Date:** 2026-05-13
**Status:** Draft for implementation
**Spec for:** `araguaney_front`
**Prior slices:** 1-8 merged. `/audit` ships in Slice 8 — its data feeds the activity panel here.

## Goal

Ship `/cycle` — a read-only operational dashboard summarizing the **current weekly cycle**: where the week is positioned (Mon-Fri), what stock is available, what's already been assigned, certificates emitted this week, active batches, and a recent-activity feed. Removes the Slice 1 ComingSoon stub.

Two header CTAs link to existing screens (`Subir lote` → `/batches`, `Nuevo certificado` → `/stock`); the dashboard does **not** mount upload modals or the cert wizard itself. The Friday sweep flow is **deferred to Slice 10**.

## Scope (in)

- Route `/cycle` with banner + 3 metric cards + 2-column body.
- Cycle banner: week number, date range (Mon-Fri), day-of-week index (1..5), progress bar showing share of stock assigned this week.
- 3 metric cards: Stock disponible, Asignado esta semana, Inversores activos (this-week distinct).
- Header CTAs: "Subir lote" (gated `batch.upload`) → `/batches`, "Nuevo certificado" (gated `certificate.create`) → `/stock`.
- Body left: "Certificados de la semana" — table of up to 10 certs from this week (incl. sweep), row click → `/certificates/{id}`.
- Body right: "Lotes activos en stock" — top 5 active batches with consumption progress + footer "Actividad reciente" with top 5 audit events from this week.
- Per-section loading + error states. Failed sections degrade gracefully (skeleton stays; rest of dashboard still works).
- Visible to all three roles (`audit.read` is universal; other reads are too).

## Scope (out)

- **Sweep flow** (simulate / issue / "Cerrar ciclo" button). Slice 10.
- **Custom date range** — dashboard is always "current week". Past-week navigation = separate ask.
- **Real-time updates** — TanStack staleTime + refetch-on-focus, no websockets.
- **Personalized greeting** ("Buenos días, María") — the mockup has it; for now we keep the standard `PageHeader` to match all other pages. Can be added in a follow-up.
- **CSV/Excel export of the dashboard** — not needed.
- **Mount the upload / wizard modals inline** — CTAs link to `/batches` and `/stock` where the modals already live.

## Architecture

```
app/(app)/cycle/page.tsx (server shell)
  └── <CyclePage> (client orchestrator)
        ├── PageHeader (breadcrumb: Operación · Panel del ciclo, title: "Panel del ciclo")
        ├── <CycleCtaButtons>   ← optional, gated by permissions
        ├── <CycleBanner>       ← week number, range, day index, progress
        ├── <CycleMetricsStrip> ← 3 cards
        └── grid 2-col
              ├── <CycleCertificatesPanel>
              └── flex-col
                    ├── <CycleBatchesPanel>
                    └── <CycleActivityFeed>
```

The orchestrator owns the 4 parallel `useQueries`. Each panel receives the corresponding `UseQueryResult` (data + isLoading + isError + refetch) so it can render its own state.

## Data sources (back endpoints)

All already exist; no back changes needed.

| Endpoint | Use | Already consumed by front? |
|---|---|---|
| `GET /api/orders/stats` | Stock disponible card | Yes (Slice 3) — `lib/api/orders.ts` `getOrdersStats()` |
| `GET /api/certificates?issue_date_from&issue_date_to` | Certs of the week + asignado metric + investors-this-week metric | Yes (Slice 5) — `listCertificates` |
| `GET /api/batches` | Active batches panel | Yes (Slice 2) — `listBatches` |
| `GET /api/audit?occurred_at_from&limit=8` | Activity feed | Yes (Slice 8) — `listAudit` |

**Open question for the implementer**: `listBatches` currently returns all batches paginated. Slice 9 wants only "active" (= not depleted, not deleted) batches. If the back's filter doesn't support that distinction today, the implementer:

1. Fetches the first page of batches (limit 50)
2. Filters client-side for batches where `consumed_pct < 100` (or however "active" is exposed)
3. Slices to top 5

If consumption % is not on the existing `BatchSummary` type, fall back to "5 most recent batches" and add a follow-up note. The dashboard is a snapshot, not a source of truth — the operator can drill into `/batches` for accurate state.

## Cycle math helper

New file: `lib/format/iso-week.ts`.

```ts
export interface CycleRange {
  weekNumber: number;   // ISO 8601 week, 1..53
  monday: string;       // 'YYYY-MM-DD' (UTC)
  friday: string;       // 'YYYY-MM-DD' (UTC)
  dayIndex: number;     // 1..5 if Mon-Fri; 5 if Sat/Sun ("cycle closed")
  weekLabel: string;    // "del 20 al 26 de abril"
}

export function currentCycleRange(now?: Date): CycleRange;
```

ISO-week formula matches the back's `helpers/iso-week.ts` (4-Thursday rule) so the front's week label always agrees with the back's `cert.cycle_week` field. UTC math, deterministic — no `toLocaleString` (tz-dependent).

Spanish month names hard-coded in the helper:
```ts
const MONTHS_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
```

If `monday.getUTCMonth() === friday.getUTCMonth()` → label `"del DD al DD de MONTH"`. If they cross months → `"del DD de MONTH1 al DD de MONTH2"`.

## Components

### `<CycleBanner>`

Props: `weekNumber`, `weekLabel`, `dayIndex`, `pctAssigned` (0..1).

Layout: dark band with pulse-dot left, "Ciclo semanal · Semana N · del 20 al 26 de abril" + subtitle "Cierra el viernes con certificado de barrido a Cashea" + on the right "Día N de 5" + 200px progress bar + "X% del stock asignado".

If `pctAssigned` is 0 (no certs yet this week), bar is empty + label "Sin asignación todavía".

3 tests.

### `<CycleMetricsStrip>`

Props: `statsQ: UseQueryResult<OrdersStats>`, `certsQ: UseQueryResult<CertificatesListResponse>`.

3 cards (re-uses the local `Card` helper pattern from prior slices):

1. **Stock disponible** — value `fmtMoney2(stats.available_capital)`. Sub: `{stats.by_status.available.count.toLocaleString()} órdenes`. Skeleton/error if `statsQ` loading/failed.
2. **Asignado esta semana** — value `fmtMoney2(sum)` where `sum = certs.data.reduce((acc, c) => acc + Number(c.investor_capital), 0)`. Sub: `{certs.total} certificado(s) emitidos`.
3. **Inversores activos** — value = `new Set(certs.data.map(c => c.investor.id)).size`. Sub: `con cert emitido esta semana`.

4 tests.

### `<CycleCertificatesPanel>`

Props: `certsQ: UseQueryResult<CertificatesListResponse>`.

Panel card with header "Certificados de la semana" + link "Ver todos →" → `/certificates`. Body:
- If `certsQ.isLoading` → skeleton row
- If `certsQ.isError` → "No se pudo cargar." text
- If empty → "Sin certificados emitidos esta semana." italic
- Else → table with columns: Código (mono small), Inversor (truncated), Capital (`fmtMoney2`), Tasa (`fmtPct`), Vence (`fmtDate`), Estado (Pill).

`Pill` variant:
- `cert.certificate_type === 'sweep'` → `Pill variant="sweep"`, label "Barrido Cashea"
- `cert.status === 'cancelled'` → `Pill variant="danger"`, label "Cancelado"
- else → reuse `<CertificateStatusPill>` from Slice 5

Row click → `router.push(/certificates/{cert.id})`. Limit 10 rows visible (slice client-side if API returns more).

4 tests.

### `<CycleBatchesPanel>`

Props: `batchesQ: UseQueryResult<BatchesListResponse>`.

Panel card with header "Lotes activos en stock" + link "Ver todos →" → `/batches`. Body shows top 5 batches that are NOT depleted (consumption < 100%). Each row:
- Left: "Lote {id_short}" + sub `{uploaded_date} · {order_count.toLocaleString()} órdenes · subido por {uploader}`
- Right: 80px progress bar with `pct` consumption + `{pct}%` label, OR ✓ when depleted (filtered out in v1 since we only show active)

3 tests.

### `<CycleActivityFeed>`

Props: `auditQ: UseQueryResult<AuditListResponse>`.

Top 5 audit entries from current week. Each row:
- Left: relative time ("hace 3h", "ayer", "lun") via `fmtRelativeTime(occurred_at, now)` — new helper, see below
- Right: `<actor> <verb> <entity>` where:
  - `<actor>` = bold `entry.actor.full_name` or `"sistema"` italic
  - `<verb>` = MAP (`create: 'creó', update: 'actualizó', cancel: 'canceló', grant: 'otorgó permiso a', revoke: 'revocó permiso de'`)
  - `<entity>` = MAP entity_type to Spanish + entity identifier (cert_code from payload if available, else id truncated)

`formatActivityEntry(entry): React.ReactNode` exported from the same file as the component, used internally + testable independently.

Empty state: "Sin actividad esta semana."

4 tests.

**`fmtRelativeTime` helper** added to `lib/format/date.ts` (sibling to `fmtDate` and `fmtDateTime`):

```ts
export function fmtRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const diffMs = now.getTime() - then.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'ahora';
  if (diffMin < 60) return `hace ${diffMin}m`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `hace ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return 'ayer';
  if (diffD < 7) return `hace ${diffD}d`;
  return fmtDate(iso); // fall back to absolute date for older entries
}
```

3 tests for the helper.

### `<CycleCtaButtons>`

Props: `userRole: MeUser['role']`.

Two `<Link>` buttons rendered conditionally:
- `hasPermission(role, 'batch.upload')` → "Subir lote" → `/batches`
- `hasPermission(role, 'certificate.create')` → "Nuevo certificado" → `/stock`

Auditor (no writes) sees neither and the container renders nothing (`return null`).

3 tests.

### `<CyclePage>` orchestrator

```tsx
'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { PageHeader } from '@/components/layout/page-header';
import { useUser } from '@/lib/auth/user-context';
import { getOrdersStats } from '@/lib/api/orders';
import { listCertificates } from '@/lib/api/certificates';
import { listBatches } from '@/lib/api/batches';
import { listAudit } from '@/lib/api/audit';
import { currentCycleRange } from '@/lib/format/iso-week';
import { CycleCtaButtons } from './cycle-cta-buttons';
import { CycleBanner } from './cycle-banner';
import { CycleMetricsStrip } from './cycle-metrics-strip';
import { CycleCertificatesPanel } from './cycle-certificates-panel';
import { CycleBatchesPanel } from './cycle-batches-panel';
import { CycleActivityFeed } from './cycle-activity-feed';

export function CyclePage() {
  const user = useUser();
  const range = useMemo(() => currentCycleRange(), []);

  const [statsQ, certsQ, batchesQ, auditQ] = useQueries({
    queries: [
      {
        queryKey: ['orders-stats'],
        queryFn: getOrdersStats,
        staleTime: 60_000,
      },
      {
        queryKey: ['certificates', { issue_date_from: range.monday, issue_date_to: range.friday, sort: 'issue_date_desc' }],
        queryFn: () =>
          listCertificates({
            issue_date_from: range.monday,
            issue_date_to: range.friday,
            sort: 'issue_date_desc',
            limit: 50,
          }),
        staleTime: 60_000,
      },
      {
        queryKey: ['batches', { active: true }],
        queryFn: () => listBatches({ limit: 50 /* TBD: filter active in plan */ }),
        staleTime: 60_000,
      },
      {
        queryKey: ['audit', { occurred_at_from: range.monday, limit: 8 }],
        queryFn: () => listAudit({ occurred_at_from: range.monday, limit: 8 }),
        staleTime: 60_000,
      },
    ],
  });

  // Pre-computed for the banner; safe because certsQ.data has a stable shape on success
  const pctAssigned = computePctAssigned(statsQ.data, certsQ.data);

  return (
    <div className="mx-auto w-full max-w-[1440px] px-9 py-7">
      <div className="flex items-start justify-between gap-4">
        <PageHeader breadcrumb={{ section: 'Operación', current: 'Panel del ciclo' }} title="Panel del ciclo" />
        <CycleCtaButtons userRole={user.role} />
      </div>
      <div className="mt-5 flex flex-col gap-4">
        <CycleBanner
          weekNumber={range.weekNumber}
          weekLabel={range.weekLabel}
          dayIndex={range.dayIndex}
          pctAssigned={pctAssigned}
        />
        <CycleMetricsStrip statsQ={statsQ} certsQ={certsQ} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
          <CycleCertificatesPanel certsQ={certsQ} />
          <div className="flex flex-col gap-4">
            <CycleBatchesPanel batchesQ={batchesQ} />
            <CycleActivityFeed auditQ={auditQ} />
          </div>
        </div>
      </div>
    </div>
  );
}

function computePctAssigned(stats: OrdersStats | undefined, certs: CertificatesListResponse | undefined): number {
  if (!stats || !certs) return 0;
  const assigned = certs.data.reduce((acc, c) => acc + Number(c.investor_capital), 0);
  const available = Number(stats.available_capital);
  const denom = assigned + available;
  return denom > 0 ? assigned / denom : 0;
}
```

3 tests for the orchestrator.

## File map

| Path | Action |
|---|---|
| `lib/format/iso-week.ts` (+ test) | create |
| `lib/format/date.ts` (modify — add `fmtRelativeTime`) | modify |
| `lib/format/date.test.ts` (modify — add 3 tests) | modify |
| `components/cycle/cycle-banner.tsx` (+ test) | create |
| `components/cycle/cycle-metrics-strip.tsx` (+ test) | create |
| `components/cycle/cycle-certificates-panel.tsx` (+ test) | create |
| `components/cycle/cycle-batches-panel.tsx` (+ test) | create |
| `components/cycle/cycle-activity-feed.tsx` (+ test) | create |
| `components/cycle/cycle-cta-buttons.tsx` (+ test) | create |
| `components/cycle/cycle-page.tsx` (+ test) | create |
| `app/(app)/cycle/page.tsx` | modify (replace ComingSoon) |

**Total:** 16 new files (8 components + 8 tests) + 3 modifications. ~32 tests new.

## Error handling

| Scenario | UI |
|---|---|
| `statsQ` fails | Stock disponible card shows "No se pudo cargar." — other cards unaffected |
| `certsQ` fails | Asignado/Inversores cards and `<CycleCertificatesPanel>` show error each. Banner's `pctAssigned` = 0 |
| `batchesQ` fails | `<CycleBatchesPanel>` shows error; other panels unaffected |
| `auditQ` fails | `<CycleActivityFeed>` shows error; other panels unaffected |
| Empty week (just past Monday, no certs yet) | All panels show appropriate empty states, banner shows "Día 1 · 0% asignado" |
| Weekend (Sat/Sun) | Banner shows "Día 5 · Ciclo cerrado", everything else normal |

No reintentar buttons (TanStack already refetches on window focus). If chronic failure, the user navigates away and comes back.

## Visual notes

- 2-col grid uses `lg:grid-cols-[1.4fr_1fr]` (cert panel slightly wider, mirroring the mockup ratio).
- Banner: dark `bg-card` with white text, accent green for the active dot. Progress bar 200px wide on desktop, full-width on mobile.
- Metric cards: same `<Card>` pattern as `<CertHeroStrip>` and `<InvestorMetricsStrip>`.
- Activity feed lines: 11px text, gray timestamp left + sentence right.

## Out-of-scope follow-ups

1. **Sweep flow** (Slice 10 — recommended next).
2. **Past-week navigation** — `?week=2026-W17` URL param.
3. **Personalized greeting** ("Buenos días, María").
4. **Realtime push** (websocket) for the activity feed.
5. **Filter the batches list server-side** for active=true — would need back to add `status` query param.

## Why each choice

| Decision | Rationale |
|---|---|
| `useQueries` (4 parallel) vs cascade | Independent data, no inter-fetch dependency. Faster first paint. |
| Per-section state vs global | One slow / failing endpoint shouldn't blank the whole dashboard. |
| Read-only this slice | The sweep flow is its own non-trivial design (Mercantil checks, ciclo-closed warnings). Keeps Slice 9 testable. |
| CTAs link instead of mounting modals | Reuses existing screens, no duplication, simpler test surface. |
| Activity feed from `/api/audit` | We already built it for Slice 8 — no new back endpoint needed. |
| Inversores activos = distinct from this-week certs | Honest definition ("inversores con cert emitido esta semana"). The mockup's "X nuevos esta semana" requires `created_at` filter on investors which the back doesn't expose; deferring. |
