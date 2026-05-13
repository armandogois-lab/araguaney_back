# araguaney_front Slice 8 — `/audit` log viewer

**Date:** 2026-05-13
**Status:** Draft for implementation
**Spec for:** `araguaney_front`
**Prior slices:** 1-7 merged. The MMY pricing change merged on the back. `/audit` is the last "system" stub route this slice claims.

## Goal

Ship `/audit` with a paginated list of `cfb.audit_log` events plus filters and a payload-detail modal. Read-only view for compliance / SUNAVAL auditability. Removes the Slice 1 ComingSoon stub.

## Scope (in)

- Route `/audit` with paginated list (50 per page).
- Filters: 3 controls — entity_type (pills + "Otros" overflow), action (pills), date range (from / to).
- Default filter: last 30 days, all entity types, all actions.
- Row click → modal showing actor + IP + user-agent + payload JSON pretty-printed.
- Cross-link to entity detail: when `entity_type === 'certificate'`, the `entity_id` cell links to `/certificates/{id}`. All other entity types display as plain mono text.
- Permission: all three roles (`operator`, `admin`, `auditor`) have `audit.read`. No visibility gating; everyone sees `/audit`.

## Scope (out)

- No edits, no deletions, no comments. The audit log is append-only by DB trigger.
- No actor filter (back supports it, but UI needs a user picker — defer to a follow-up if requested).
- No CSV/Excel export of audit entries (separate ask; would mirror the Slice 7 pattern with `exceljs` lazy import).
- No saved filters / bookmarks.
- No realtime push (events are recorded async; user refreshes if they want updates).
- No cross-link for entity types other than `certificate`. The other 11 entity types either don't have a detail page yet (`batch`, `order`, `investor`, etc.) or are conceptual (`system`). When they get detail pages, this component is the place to add the link.

## Architecture

```
app/(app)/audit/page.tsx (server shell)
  └── <AuditPage> (client orchestrator)
        ├── PageHeader (breadcrumb "Sistema · Auditoría", title "Auditoría")
        ├── <AuditFilters> (state lifted to AuditPage)
        ├── <AuditTable>
        │     └── useQuery(['audit', query]) → listAudit
        │     └── <AuditRow> × N (props: entry, onSelect)
        └── <AuditDetailModal> (mounted when selectedEntry !== null)
```

Same shape as `/investors` and `/certificates`. Stateless children except `<AuditFilters>` (no internal state — value lifted to orchestrator). Orchestrator owns `filters`, `page`, `selectedEntry`.

## Back contract

`GET /api/audit` already exists at `src/modules/admin/audit/audit.controller.ts` on the back. Permission `audit.read` (operator + admin + auditor per the seed).

**Query params (all optional except pagination):**

| Param | Type | Notes |
|---|---|---|
| `limit` | int | default from PaginationSchema |
| `offset` | int | default 0 |
| `entity_type` | enum | one of: `batch`, `order`, `installment`, `certificate`, `certificate_order`, `investor`, `merchant`, `end_user`, `user`, `setting`, `role_permission`, `system` |
| `entity_id` | string | requires `entity_type` (back rejects with 400 otherwise) |
| `actor_id` | uuid | not used by this slice |
| `action` | string | observed values today: `create`, `update`, `cancel`, `grant`, `revoke` |
| `occurred_at_from` | ISO date | `gte` |
| `occurred_at_to` | ISO date | `lte` |

**Response shape:**

```ts
{
  data: AuditEntry[],
  total: number,
  limit: number,
  offset: number,
}

interface AuditEntry {
  id: string;             // uuid
  occurred_at: string;    // ISO timestamp
  actor: { id: string; email: string; full_name: string } | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  payload: unknown;       // jsonb
}
```

## Front types (`lib/types/audit.ts`)

```ts
export type AuditEntityType =
  | 'batch'
  | 'order'
  | 'installment'
  | 'certificate'
  | 'certificate_order'
  | 'investor'
  | 'merchant'
  | 'end_user'
  | 'user'
  | 'setting'
  | 'role_permission'
  | 'system';

export type AuditAction = 'create' | 'update' | 'cancel' | 'grant' | 'revoke' | string;

export interface AuditActor {
  id: string;
  email: string;
  full_name: string;
}

export interface AuditEntry {
  id: string;
  occurred_at: string;
  actor: AuditActor | null;
  action: AuditAction;
  entity_type: AuditEntityType;
  entity_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  payload: unknown;
}

export interface AuditListResponse {
  data: AuditEntry[];
  total: number;
  limit: number;
  offset: number;
}
```

`AuditAction` is intentionally `'create' | 'update' | ... | string` so the union narrows to known cases but accepts any new action the back might add in future. The pill component falls back to `neutral` for unknown values.

## Front API (`lib/api/audit.ts`)

```ts
'use server';

import { apiFetch } from './client';
import { ApiError } from './error';
import type { AuditEntityType, AuditListResponse } from '@/lib/types/audit';

function rethrowWithMessage(err: unknown): never {
  if (err instanceof ApiError) {
    const body = err.body as { message?: string } | null;
    throw new Error(body?.message ?? `Error del servidor (${err.status})`);
  }
  throw err;
}

export interface ListAuditQuery {
  limit?: number;
  offset?: number;
  entity_type?: AuditEntityType;
  action?: string;
  occurred_at_from?: string;
  occurred_at_to?: string;
}

export async function listAudit(query: ListAuditQuery = {}): Promise<AuditListResponse> {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.offset !== undefined) params.set('offset', String(query.offset));
  if (query.entity_type) params.set('entity_type', query.entity_type);
  if (query.action) params.set('action', query.action);
  if (query.occurred_at_from) params.set('occurred_at_from', query.occurred_at_from);
  if (query.occurred_at_to) params.set('occurred_at_to', query.occurred_at_to);
  const qs = params.toString();
  try {
    return await apiFetch<AuditListResponse>(`/api/audit${qs ? '?' + qs : ''}`, { method: 'GET' });
  } catch (err) {
    rethrowWithMessage(err);
  }
}
```

Mirrors `lib/api/certificates.ts` and `lib/api/investors.ts`. Same `rethrowWithMessage` pattern.

## Components

### `<AuditActionPill>`

Wraps `Pill` with a fixed mapping:

```ts
const MAP: Record<string, { variant: PillVariant; label: string }> = {
  create:  { variant: 'success', label: 'Crear' },
  update:  { variant: 'info',    label: 'Actualizar' },
  cancel:  { variant: 'danger',  label: 'Cancelar' },
  grant:   { variant: 'success', label: 'Otorgar' },
  revoke:  { variant: 'warn',    label: 'Revocar' },
};

export function AuditActionPill({ action }: { action: string }) {
  const m = MAP[action] ?? { variant: 'neutral' as const, label: action };
  return <Pill variant={m.variant}>{m.label}</Pill>;
}
```

Fallback uses the raw action string (in case the back adds new ones).

### `<AuditEntityLink>`

```ts
interface Props {
  entityType: AuditEntityType;
  entityId: string | null;
}

export function AuditEntityLink({ entityType, entityId }: Props) {
  if (!entityId) return <span className="text-text-3">—</span>;
  if (entityType === 'certificate') {
    return (
      <Link href={`/certificates/${entityId}`} className="text-text-2 font-mono text-[11.5px] hover:underline">
        {entityId}
      </Link>
    );
  }
  return <span className="text-text-2 font-mono text-[11.5px]">{entityId}</span>;
}
```

When more entity detail routes ship in the future, extend the conditional here.

### `<AuditRow>`

A `<tr>` with 6 columns:

| Column | Source |
|---|---|
| Fecha | `fmtDateTime(occurred_at)` — see "New format helper" below |
| Actor | `actor.full_name` or "sistema" if null |
| Acción | `<AuditActionPill>` |
| Entidad | `entity_type` (raw value, lowercase) |
| ID | `<AuditEntityLink>` |
| IP | `ip_address ?? '—'`, mono small text |

Row is clickable → `onSelect(entry)`. The orchestrator opens the modal.

### `<AuditFilters>`

Three groups in one row, wrapping on narrow viewports:

**Entity type pills**: `Todos`, `Certificate`, `Investor`, `Batch`, `Order`, `Setting`, `User`, `Role-permission`. The 5 less-common types (`installment`, `certificate_order`, `merchant`, `end_user`, `system`) go in a `<select aria-label="Otros tipos">` dropdown with options `Otros…`, `installment`, `certificate_order`, `merchant`, `end_user`, `system`. Selecting from "Otros" sets `entityType` to that value AND deactivates the regular pill. Selecting a regular pill resets "Otros" back to its placeholder.

**Action pills**: `Todas`, `Crear`, `Actualizar`, `Cancelar`, `Otorgar`, `Revocar`.

**Date inputs**: `Desde` (date input) + `Hasta` (date input).

Stateless except for `qLocal` — wait, no `q` in this filter. Pure controlled component. Parent owns `value`.

Default value (computed by parent):

```ts
const today = new Date();
const thirtyDaysAgo = new Date();
thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

const INITIAL_FILTERS: AuditFiltersValue = {
  entityType: 'all',
  action: 'all',
  dateFrom: thirtyDaysAgo.toISOString().slice(0, 10),
  dateTo: today.toISOString().slice(0, 10),
};
```

(The default is computed inside the orchestrator's render, **not** at module load — otherwise it'd freeze at first import.)

### `<AuditTable>`

Same `useQuery + placeholderData + paginated footer` pattern as Slice 5/6:

- `useQuery(['audit', query])` with `staleTime: 30s`, `refetchOnWindowFocus: true`, `placeholderData: prev`.
- Loading → skeleton card "Cargando eventos…".
- Error → "No se pudieron cargar los eventos." + Reintentar.
- Empty → "Sin eventos en este rango."
- Data → table + footer `Mostrando N–M de total` + prev/next buttons.

Exports `buildQuery(filters, page)` so the orchestrator can match the cache key directly if needed (no metrics strip in this slice, but kept for symmetry — actually not needed; can be private).

### `<AuditDetailModal>`

Props: `entry: AuditEntry`, `onClose: () => void`.

Layout:

```
┌──────────────────────────────────────────────┐
│ {ACTION.toUpperCase()} · {entity_type}      ×│
│ 13/05/2026 14:32:18                          │
├──────────────────────────────────────────────┤
│ QUIÉN                                        │
│ ─────                                        │
│ Actor      María Rodríguez (op@cashea.app)   │
│ IP         190.123.45.67                     │
│ User-agent Mozilla/5.0 (Macintosh; Intel...) │
├──────────────────────────────────────────────┤
│ QUÉ                                          │
│ ─────                                        │
│ {                                            │
│   "before": {...},                           │
│   "after": {...}                             │
│ }                                            │
└──────────────────────────────────────────────┘
                              [Cerrar]
```

Payload renders with `JSON.stringify(payload, null, 2)` inside `<pre>` with `font-mono text-[11px] whitespace-pre-wrap break-all max-h-[400px] overflow-auto`. Empty payload (`{}` or `null`) shows "Sin datos adicionales en el payload." italic.

Actor null shows "sistema" in italic. IP/user-agent null shows "—".

Backdrop click closes. × button closes. No mutations.

### `<AuditPage>` orchestrator

```tsx
'use client';

import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { AuditFilters, type AuditFiltersValue } from './audit-filters';
import { AuditTable } from './audit-table';
import { AuditDetailModal } from './audit-detail-modal';
import type { AuditEntry } from '@/lib/types/audit';

function defaultFilters(): AuditFiltersValue {
  const today = new Date();
  const thirty = new Date();
  thirty.setDate(thirty.getDate() - 30);
  return {
    entityType: 'all',
    action: 'all',
    dateFrom: thirty.toISOString().slice(0, 10),
    dateTo: today.toISOString().slice(0, 10),
  };
}

export function AuditPage() {
  const initial = useMemo(defaultFilters, []);
  const [filters, setFiltersInternal] = useState<AuditFiltersValue>(initial);
  const [page, setPage] = useState(0);
  const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null);

  function setFilters(next: AuditFiltersValue) {
    setFiltersInternal(next);
    setPage(0);
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] px-9 py-7">
      <PageHeader breadcrumb={{ section: 'Sistema', current: 'Auditoría' }} title="Auditoría" />
      <div className="mt-6 flex flex-col gap-6">
        <AuditFilters value={filters} onChange={setFilters} />
        <AuditTable
          filters={filters}
          page={page}
          onPageChange={setPage}
          onSelectEntry={setSelectedEntry}
        />
      </div>
      {selectedEntry && (
        <AuditDetailModal entry={selectedEntry} onClose={() => setSelectedEntry(null)} />
      )}
    </div>
  );
}
```

## Route wire-up

`app/(app)/audit/page.tsx` replaces the ComingSoon stub:

```tsx
import { AuditPage } from '@/components/audit/audit-page';

export default function AuditRoute() {
  return <AuditPage />;
}
```

## Error handling

| Scenario | UI |
|---|---|
| List fetch fails (500) | Inline error card with Reintentar |
| Empty result (filters match no events) | "Sin eventos en este rango." |
| 403 (rare — `audit.read` is universal but possible if seed regressed) | Generic toast.error and the list-fetch error state. Not a normal path. |
| Modal opens with malformed payload (e.g. `payload === null`) | "Sin datos adicionales en el payload." (italic) |
| Network failure | `rethrowWithMessage` → "Error de red, reintenta" via the table's error state |

## Testing

~29 tests new. Patterns:

- `lib/api/audit.test.ts`: 3 — no-params GET, all-filters serialization, no `entity_id` filter exposed by Server Action (intentional — Slice 8 doesn't filter by single ID).
- `<AuditActionPill>`: 5 — one per known action + one for unknown fallback.
- `<AuditEntityLink>`: 4 — cert link, batch plain, investor plain, null → "—".
- `<AuditRow>`: 3 — render columns, click onSelect, actor null shows "sistema".
- `<AuditFilters>`: 4 — default pills active, click pill emits, click action pill emits, date input change emits.
- `<AuditTable>`: 5 — skeleton, empty, error, data + footer, `entityType='all'` → undefined in API call.
- `<AuditDetailModal>`: 4 — header, payload pretty-print, backdrop closes, empty payload shows fallback.
- `<AuditPage>`: 2 — smoke + row click opens modal.

No new tests for the route wire-up file (it's a one-liner mount, tested by build success).

## New format helper

`lib/format/date.ts` already exports `fmtDate(iso)` which produces `DD/MM/YYYY`. The audit list needs time-of-day too. Add a sibling export:

```ts
export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  return `${date} ${time}`;
}
```

Plus 2 tests in `lib/format/date.test.ts` (basic format + handles ISO with timezone).

## Files map

**New (in `araguaney_front/`):**

- `lib/types/audit.ts`
- `lib/api/audit.ts` + `lib/api/audit.test.ts`
- `components/audit/audit-action-pill.tsx` + test
- `components/audit/audit-entity-link.tsx` + test
- `components/audit/audit-row.tsx` + test
- `components/audit/audit-filters.tsx` + test
- `components/audit/audit-table.tsx` + test
- `components/audit/audit-detail-modal.tsx` + test
- `components/audit/audit-page.tsx` + test

**Modified:**

- `app/(app)/audit/page.tsx` (replace ComingSoon)
- `lib/format/date.ts` (add `fmtDateTime` helper)
- `lib/format/date.test.ts` (add 2 tests for `fmtDateTime`)

**Total:** 17 new files + 3 modifications. ~31 tests new (29 for audit + 2 for `fmtDateTime`).

## Permissions matrix (Slice 8)

| Action | operator | admin | auditor |
|---|:---:|:---:|:---:|
| View list | ✓ | ✓ | ✓ |
| View detail (modal) | ✓ | ✓ | ✓ |
| Export | — | — | — |

All gated by `audit.read` which is already on all three roles.

## Out-of-scope follow-ups

1. **Actor filter dropdown** — `actor_id` is supported by the back; UI would need a `listUsers()` call. Add in a follow-up if compliance asks "what did María do this month?".
2. **CSV/Excel export** — mirror Slice 7's pattern with `exceljs` lazy import. Probably want both Resumen + raw rows.
3. **Cross-link expansion** — when `/batches/[id]`, `/investors/[id]`, etc. detail pages ship, extend `<AuditEntityLink>`.
4. **Saved filter presets** — "show me all cancels this month" as a one-click saved query. Edge case until volume justifies it.
5. **Realtime push** — only if compliance workflows demand it (probably not for an internal back-office tool).

These belong in future slices.

## Why each design choice

| Decision | Rationale |
|---|---|
| Modal vs drawer for detail | Modal is the established pattern (cancel cert, edit investor). Drawers add a new component family for one screen. |
| Cross-link only for certificates | Only entity with a detail page today. Linking missing routes would 404. |
| 30-day default range | Compliance typically reviews the last month. Bounded result set keeps the table fast. |
| Pills + "Otros" dropdown for entity_type | 12 entity types in a single row of pills is visually cluttered. Pills cover 7 most-used + dropdown covers the long tail. |
| No actor filter in v1 | Adds a user-list dropdown dependency. Not blocking compliance use cases; defer. |
| Payload as raw JSON in `<pre>` | Audit log payloads have no fixed shape per entity. Pretty-printed JSON is honest and complete. A "diff view" is much fancier and only worthwhile if the payloads consistently follow a `{before, after}` shape (they don't today). |
