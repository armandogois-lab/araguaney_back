# araguaney_front Slice 6 — `/investors` CRUD design

**Date:** 2026-05-11
**Status:** Draft for implementation
**Spec for:** `araguaney_front` (Next.js 16 app router)
**Prior slice:** Slice 5 — `/certificates` list + detail + cancel (merged)

## Goal

Ship `/investors` with list + filters + registration + edit. Removes the Slice 1 ComingSoon stub and closes the investor management loop so operators don't need to drop into the wizard or the DB to manage investors.

## Scope (in)

- Route `/investors` with paginated list.
- Filters: search by razón social or RIF (300ms debounce), 3-pill status filter (Todos / Activos / Inactivos).
- 2-card metric strip: **Inversores activos** (count) and **Capital colocado** (sum of `total_invested`).
- "Registrar inversor" button in the header → modal that mounts the existing `<InvestorCreateForm>` from the wizard.
- Click row → modal to edit `legal_name`, `email`, `phone`, `notes`, `status`. Calls `PATCH /api/investors/:id`.
- Permission gating on register/edit (auditor sees the list but no actions).

## Scope (out)

- No `/investors/[id]` detail page. A future slice can add it (history of certificates emitted to the investor, audit timeline).
- No edit of `rif` or `kind` — both are immutable post-creation per back contract.
- No `avg_rate` or `last_issued_date` columns — back does not expose these.
- No "Nuevos en abril" metric card — was hardcoded in the mockup, not derivable from current API.
- No export to Excel.
- No display or management of the `kind='internal'` investor (Cashea itself). Filtered out client-side.

## Architecture

```
app/(app)/investors/page.tsx (server shell)
  └── <InvestorsPage> (client orchestrator)
        ├── PageHeader
        ├── <InvestorMetricsStrip> (props: response.data)
        ├── <InvestorsFilters> (state: lifted to InvestorsPage)
        ├── <InvestorsTable>
        │     └── useQuery(['investors', query]) → listInvestors
        │     └── <InvestorRow> × N (props: investor, onEdit?)
        ├── <InvestorCreateModal> (mounted when createOpen)
        │     └── <InvestorCreateForm> (re-used from components/cert-wizard/)
        └── <InvestorEditModal> (mounted when editTarget !== null)
              └── useMutation(updateInvestor) + Zod-mirror form
```

Same shape as `/certificates` orchestrator. Stateless children where possible; orchestrator owns `filters`, `page`, `createOpen`, `editTarget`.

## Foundation cleanup (Task 1 of plan)

**Permission key mismatch found during brainstorm:**

The back uses two separate permission keys:
- `investor.create` (POST /api/investors)
- `investor.update` (PATCH /api/investors/:id)

The front's `lib/permissions/has-permission.ts` declares a single `investor.write` key (currently dead — no consumer references it). The DB seed and the back enforce the split keys.

Slice 6 fixes this:
- Drop `investor.write` from `OPERATOR_PERMS`.
- Add `investor.create` and `investor.update` to `OPERATOR_PERMS`.
- Admin auto-inherits via spread.
- Auditor unchanged (read-only).
- Update tests accordingly.

This unblocks the gating logic for the register/edit buttons.

## Components

### `<InvestorStatusPill>`
Wraps `Pill`. Maps `'active'` → success (Activo), `'inactive'` → neutral (Inactivo). 2 tests.

### `<InvestorRow>`
A `<tr>` with 5 columns: razón social, RIF (mono), certificados (`{active_cert_count}` formatted as "N activos"), capital activo (`fmtMoney2(total_invested)`, dash when 0), status pill. Receives optional `onEdit(investor)`; renders `cursor-pointer` only when prop is present (auditor doesn't get edit affordance). 3 tests.

### `<InvestorsFilters>`
- 3 status pills: Todos / Activos / Inactivos (default Activos).
- Search input (placeholder "Buscar por razón social o RIF…"), debounced 300ms.
- Stateless except for the debounce. Parent owns `value`. 5 tests.

`InvestorsFiltersValue` type:
```ts
{
  status: 'all' | 'active' | 'inactive',  // default 'active'
  q: string,                                // debounced
}
```

**Note on default:** the mockup uses `'all'` as the default; this spec overrides to `'active'` to match the `/certificates` pattern (focus on operational state by default). Reasonable to change to `'all'` if user prefers wider initial view.

### `<InvestorsTable>`
- `useQuery(['investors', query])` calling `listInvestors({ limit: 50, offset, q, status, sort: 'name_asc' })`.
- Filters out `kind === 'internal'` client-side before passing to the row map. Comment in code: back does not support `kind!=internal` query param today.
- Loading / empty / error / data states (same patterns as `<CertificatesTable>`).
- Pagination footer: prev/next + "Mostrando N–M de total".
- Receives `onEditInvestor` prop, threads through to `<InvestorRow>` only when caller is permitted to edit.
- 6 tests.

### `<InvestorMetricsStrip>`
Reads the same `['investors', query]` key via `useQuery` (TanStack returns the cached page — no second fetch). Computes:
- **Inversores activos** = `data.data.filter(i => i.status === 'active').length`
- **Capital colocado** = sum of `Number(i.total_invested)` for active investors

Receives `query` as a prop to match the table's exact cache key. Renders 2 cards. Honest sub-label: "de N en página" (acknowledging page-scoped data; a back stats endpoint would unlock global aggregation later). 3 tests.

### `<InvestorCreateModal>`
Thin wrapper around `<InvestorCreateForm>` (from `components/cert-wizard/`). Backdrop click closes. The existing form already invalidates `['investors']` internally (verified) and exposes an `onCreated(inv)` callback. The modal passes `onCreated={(inv) => { toast.success(`Inversor ${inv.legal_name} registrado`); onClose(); }}` and never duplicates the cache invalidation. The form's existing inline error display stays. Modal does not expose a `notes` field at this time (the existing form doesn't either; if `notes` is needed it can be added in a follow-up to both create and edit forms together). 4 tests.

### `<InvestorEditModal>`
- Takes `investor: InvestorSummary` + `onClose`.
- Local form state initialized from investor.
- Fields: `legal_name` (text input, required, 1-255), `email` (text input, optional, format-validated, nullable), `phone` (text input, optional, 1-50 if present, nullable), `notes` (textarea, optional, 0-1000, nullable), `status` (two-button toggle: Activo | Inactivo).
- Validation client-side mirrors the back's `InvestorUpdateSchema`. Errors shown inline.
- `useMutation(updateInvestor)` — body contains only dirty fields. At least one must be dirty (back rejects empty payloads).
- Confirm button disabled when no fields are dirty OR when validation errors exist OR while mutation pending.
- On success: invalidate `['investors']`, toast, close.
- On error: toast error, modal stays open.
- 6 tests.

### `<InvestorsPage>` orchestrator
Owns `filters`, `page`, `createOpen`, `editTarget`. Permission check `hasPermission(user.role, 'investor.create')` gates the "Registrar" button. `hasPermission(user.role, 'investor.update')` gates passing `onEditInvestor` to the table.

PageHeader breadcrumb: `Operación · Inversores`. Title: `Inversores`. 3 tests.

### Route wire-up
`app/(app)/investors/page.tsx` replaces ComingSoon with `<InvestorsPage />`. Same pattern as Slice 5.

## Types

Extend `lib/types/investor.ts`:

```ts
export type InvestorKind = 'juridica' | 'natural' | 'internal';
export type InvestorStatus = 'active' | 'inactive';

export interface InvestorActor {
  id: string;
  email: string;
  full_name: string;
}

export interface InvestorSummary {
  id: string;
  legal_name: string;
  rif: string;
  kind: InvestorKind;
  status: InvestorStatus;
  email: string | null;
  phone: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  updated_by: InvestorActor | null;
  active_cert_count: number;
  total_invested: string;  // Decimal serialized
}

export interface InvestorsListResponse {
  data: InvestorSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface InvestorCreate {
  legal_name: string;
  rif: string;
  kind: 'juridica' | 'natural';  // 'internal' is not creatable
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
}

export interface InvestorUpdate {
  legal_name?: string;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  status?: InvestorStatus;
}
```

This extends the current `InvestorSummary` (which has fewer fields). The wizard's consumer of `InvestorSummary.legal_name` and `.rif` keeps working since those fields stay.

## API surface

Extend `lib/api/investors.ts`:

```ts
// Already exists
export async function listInvestors(query: ListInvestorsQuery): Promise<InvestorsListResponse>;
export async function createInvestor(body: InvestorCreate): Promise<InvestorSummary>;

// NEW
export async function updateInvestor(id: string, body: InvestorUpdate): Promise<InvestorSummary>;
```

`updateInvestor` calls `PATCH /api/investors/${id}` with JSON body. Uses the same `rethrowWithMessage` pattern.

## Permissions matrix (Slice 6)

| Action | operator | admin | auditor |
|---|:---:|:---:|:---:|
| View list | ✓ | ✓ | ✓ |
| Open create modal | ✓ | ✓ | — |
| Edit existing | ✓ | ✓ | — |
| Cancel/delete investor | not yet (no endpoint) | not yet | — |

## Error handling

| Scenario | UI |
|---|---|
| List fetch fails | Inline error card with Reintentar button (mirrors `<CertificatesTable>`) |
| List returns empty after filters | "Ningún inversor coincide con los filtros." |
| Create RIF conflict (409) | `toast.error("Ya existe un inversor con ese RIF")`. Modal stays open. (Back currently returns generic message; the modal reads `err.message`.) |
| Create validation (400) | `toast.error(err.message)`. Modal stays open. |
| Update no-op (no dirty fields) | Confirm button disabled. No call made. |
| Update validation (400) | `toast.error(err.message)`. Modal stays open. |
| Network failure | `toast.error("Error de red, reintenta")` (fallback in `rethrowWithMessage`). |

## Testing

Vitest + Testing Library. `renderWithQuery` for components that mount queries. `vi.hoisted` for cross-module mocks. `UserProvider` wrapper for components that consume `useUser`.

**Approximate test count:** ~32 new (8 components + 1 API + 1 permission update).

Coverage targets:
- All paths in `<InvestorEditModal>` (init from props, dirty tracking, validation, success, error, close).
- Permission gating verified for `<InvestorsPage>` (button hidden for auditor, edit affordance hidden for auditor).
- `kind='internal'` is excluded from `<InvestorsTable>` render even when present in API response.

## Out-of-scope but worth noting for future slices

1. **Back: investor stats endpoint** — `GET /api/investors/stats` returning global active count, total capital, weighted avg rate, new-this-month. Would unlock truthful metric cards.
2. **Back: investor detail returning embedded certificates** — `GET /api/investors/:id` could include the investor's certificate history. Would unlock a useful detail page.
3. **Soft-delete investors** — back has no DELETE endpoint. Currently inactivation via `status='inactive'`. Acceptable.
4. **`kind='internal'` server-side filter** — `GET /api/investors?exclude_internal=true` would let us drop the client-side filter.

These belong in Slice 7+ or back-side work.

## Files (summary)

**New (in `araguaney_front/`):**
- `components/investors/investor-status-pill.tsx` + test
- `components/investors/investor-row.tsx` + test
- `components/investors/investors-filters.tsx` + test
- `components/investors/investors-table.tsx` + test
- `components/investors/investor-metrics-strip.tsx` + test
- `components/investors/investor-create-modal.tsx` + test
- `components/investors/investor-edit-modal.tsx` + test
- `components/investors/investors-page.tsx` + test

**Modified:**
- `lib/types/investor.ts` (extend types)
- `lib/api/investors.ts` (add updateInvestor)
- `lib/permissions/has-permission.ts` (replace `investor.write` with `investor.create` + `investor.update`)
- `lib/permissions/has-permission.test.ts`
- `app/(app)/investors/page.tsx` (replace stub)

**Total:** 16 new files + 5 modifications.
