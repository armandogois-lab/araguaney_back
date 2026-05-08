# araguaney_front Slice 3 — `/stock` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `/stock` page on `araguaney_front`: stat banner (Capital disponible · Órdenes disponibles · Certs emitidos esta semana) + 4-filter row (status pills, merchant dropdown, max-due-date, code search) + paginated orders table. No detail view.

**Architecture:** Server Component shell mounts a Client orchestrator. `<StockPage>` composes `<PageHeader>` + `<StockStatsBanner>` + `<StockFilters>` + `<StockTable>`. Three hot TanStack `useQuery` hooks: orders-stats, certs-this-week, merchants (banner + filter dropdown), and a fourth keyed by `[filters, page]` for the table. No mutations — Stock is read-only.

**Tech Stack:** Next.js 16 App Router (existing), TanStack Query v5 (existing), shadcn/ui base-nova primitives + extended `<Pill>` (add `danger` variant), Vitest + Testing Library, hand-typed response shapes (back openapi gap, identical pattern to Slice 2).

**Spec:** `docs/superpowers/specs/2026-05-08-front-slice-3-stock-design.md`

**Working directory note:** all front code lives in `/Users/llam/dev/araguaney_front/`. The plan and spec live in `/Users/llam/dev/araguaney_back/docs/`. Implementer must `cd /Users/llam/dev/araguaney_front` for any task command.

**Pre-req branch:** Work on `feat/slice-3-stock` (Task 1 creates this from `main`; subsequent tasks just commit to it).

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `lib/types/order.ts` | create | `OrderStatus`, `OrderSummary`, `OrdersListResponse`, `OrdersStats` |
| `lib/types/merchant.ts` | create | `MerchantSummary`, `MerchantsListResponse` |
| `lib/format/week.ts` | create | `mondayOfThisWeekUTC()`, `todayUTC()` for the cert-this-week query |
| `lib/format/week.test.ts` | create | Tests across week boundaries |
| `lib/api/orders.ts` | create | Server Actions: `listOrders(query)`, `getOrdersStats()` |
| `lib/api/orders.test.ts` | create | Tests with mocked `apiFetch` |
| `lib/api/merchants.ts` | create | Server Action: `listMerchants(query)` |
| `lib/api/merchants.test.ts` | create | Tests |
| `lib/api/certificates.ts` | create | Server Action: `countCertificatesIssued(from, to)` |
| `lib/api/certificates.test.ts` | create | Tests |
| `components/ui/pill.tsx` | modify | Add `danger` variant |
| `components/ui/pill.test.tsx` | modify | Test for the new variant |
| `components/stock/order-status-pill.tsx` | create | `Pill` wrapper mapping `OrderStatus` → variant + Spanish label |
| `components/stock/order-status-pill.test.tsx` | create | One assertion per status |
| `components/stock/order-row.tsx` | create | Single `<tr>` with formatted columns |
| `components/stock/order-row.test.tsx` | create | Renders code/date/merchant/cuotas/monto/pill |
| `components/stock/stock-stats-banner.tsx` | create | 3 cards with stats + cert-this-week count |
| `components/stock/stock-stats-banner.test.tsx` | create | Loading / error / success / formato |
| `components/stock/stock-filters.tsx` | create | Segmented status + merchant `<select>` + date input + debounced search |
| `components/stock/stock-filters.test.tsx` | create | Each filter triggers `onChange` correctly; debounce works |
| `components/stock/stock-table.tsx` | create | TanStack `useQuery` + table + skeleton/error/empty + pagination footer |
| `components/stock/stock-table.test.tsx` | create | Tests with mocked `listOrders` |
| `components/stock/stock-page.tsx` | create | Client orchestrator: page header + banner + filters + table + state |
| `components/stock/stock-page.test.tsx` | create | Smoke: full render + filter change re-keys table |
| `app/(app)/stock/page.tsx` | modify | Replace `<ComingSoon />` with `<StockPage />` |

**Total:** 25 files (12 source + 12 tests + 1 modified route).

**Manual operational tasks:**

| Action | Owner | When |
|---|---|---|
| Push branch + open PR | controller | Task 14 |
| Review + merge | user | After Task 14 |
| Verify Vercel deploy + visual smoke | user | Post-merge |

---

## Task 1: Branch + types (`order.ts`, `merchant.ts`)

**Why:** Lock the wire shape before any code consumes it. The back's `/api/orders` response is rich enough that a typo in property names would cascade through every component.

**Files:**
- Create: `lib/types/order.ts`
- Create: `lib/types/merchant.ts`

- [ ] **Step 1: Create branch from main**

```bash
cd /Users/llam/dev/araguaney_front
git fetch origin --prune
git checkout main
git pull origin main
git checkout -b feat/slice-3-stock
```

- [ ] **Step 2: Create `lib/types/order.ts`**

Create `/Users/llam/dev/araguaney_front/lib/types/order.ts`:

```ts
export type OrderStatus = 'available' | 'assigned' | 'matured' | 'defaulted';

export interface OrderMerchantRef {
  id: string;
  current_name: string;
  rif: string;
}

export interface OrderEndUserRef {
  id: string;
  external_hash: string;
  national_id: string | null;
  full_name: string | null;
}

export interface OrderBatchRef {
  id: string;
  external_code: string;
}

export interface OrderSummary {
  id: string;
  external_order_id: string;
  status: OrderStatus;
  purchase_date: string;        // ISO date "YYYY-MM-DD"
  max_due_date: string;
  total_amount: string;          // Decimal as string
  installments_sum: string;
  num_installments: number;
  imported_at: string;           // ISO timestamp
  merchant: OrderMerchantRef;
  end_user: OrderEndUserRef;
  batch: OrderBatchRef;
}

export interface OrdersListResponse {
  data: OrderSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface OrdersStatsBucket {
  count: number;
  total_amount: string;
  total_installments_amount: string;
}

export interface OrdersStats {
  by_status: {
    available: OrdersStatsBucket;
    assigned: OrdersStatsBucket;
    matured: OrdersStatsBucket;
    defaulted: OrdersStatsBucket;
  };
  total_orders: number;
  available_capital: string;
}
```

- [ ] **Step 3: Create `lib/types/merchant.ts`**

Create `/Users/llam/dev/araguaney_front/lib/types/merchant.ts`:

```ts
export interface MerchantSummary {
  id: string;
  rif: string;
  current_name: string;
  orders_count: number;
}

export interface MerchantsListResponse {
  data: MerchantSummary[];
  total: number;
  limit: number;
  offset: number;
}
```

- [ ] **Step 4: Verify typecheck**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add lib/types/order.ts lib/types/merchant.ts
git commit -m "$(cat <<'EOF'
feat(types): add OrderSummary + MerchantSummary shapes

Hand-typed against the back's /api/orders and /api/merchants responses
(back openapi has gaps, identical pattern to Slice 2's batch.ts).
Stock-de-órdenes consumers in subsequent tasks reference these.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `lib/format/week.ts`

**Why:** The cert-this-week banner card needs `?issue_date_from=lunes&issue_date_to=hoy`. Doing this with `Date` math is error-prone (Sunday-as-week-start trap, timezone drift). Pure helper, easy to test.

**Files:**
- Create: `lib/format/week.ts`
- Create: `lib/format/week.test.ts`

- [ ] **Step 1: Write failing test**

Create `/Users/llam/dev/araguaney_front/lib/format/week.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mondayOfThisWeekUTC, todayUTC } from './week';

describe('mondayOfThisWeekUTC', () => {
  it('returns the same day when given a Monday', () => {
    // 2026-05-04 is a Monday
    const monday = new Date(Date.UTC(2026, 4, 4, 14, 30, 0));
    expect(mondayOfThisWeekUTC(monday)).toBe('2026-05-04');
  });

  it('returns the previous Monday when given a Wednesday', () => {
    // 2026-05-06 Wed → Monday is 2026-05-04
    const wed = new Date(Date.UTC(2026, 4, 6, 9, 0, 0));
    expect(mondayOfThisWeekUTC(wed)).toBe('2026-05-04');
  });

  it('returns the previous Monday when given a Sunday', () => {
    // 2026-05-10 Sun → Monday is 2026-05-04 (NOT 2026-05-11)
    const sun = new Date(Date.UTC(2026, 4, 10, 23, 59, 59));
    expect(mondayOfThisWeekUTC(sun)).toBe('2026-05-04');
  });

  it('returns the previous Monday when given a Saturday', () => {
    // 2026-05-09 Sat → Monday is 2026-05-04
    const sat = new Date(Date.UTC(2026, 4, 9, 12, 0, 0));
    expect(mondayOfThisWeekUTC(sat)).toBe('2026-05-04');
  });
});

describe('todayUTC', () => {
  it('returns the date portion of the given moment in UTC', () => {
    const t = new Date(Date.UTC(2026, 4, 8, 23, 59, 0));
    expect(todayUTC(t)).toBe('2026-05-08');
  });

  it('uses the current date when called with no argument', () => {
    const result = todayUTC();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/format/week.test.ts
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `lib/format/week.ts`**

Create `/Users/llam/dev/araguaney_front/lib/format/week.ts`:

```ts
function isoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Returns YYYY-MM-DD of the most recent Monday at-or-before `d` in UTC.
 * Week starts on Monday (operations use lunes-as-week-start).
 */
export function mondayOfThisWeekUTC(d: Date = new Date()): string {
  const dow = d.getUTCDay();           // 0=Sun, 1=Mon, ..., 6=Sat
  const daysFromMonday = (dow + 6) % 7; // Mon→0, Tue→1, ..., Sun→6
  const monday = new Date(d);
  monday.setUTCDate(monday.getUTCDate() - daysFromMonday);
  return isoDate(monday);
}

/** Returns YYYY-MM-DD for the given date in UTC (default: now). */
export function todayUTC(d: Date = new Date()): string {
  return isoDate(d);
}
```

- [ ] **Step 4: Confirm tests pass**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/format/week.test.ts
```

Expected: 6 tests green.

- [ ] **Step 5: Verify suite + format**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

Expected: all clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add lib/format/week.ts lib/format/week.test.ts
git commit -m "$(cat <<'EOF'
feat(format): mondayOfThisWeekUTC + todayUTC helpers

Computes Monday-as-week-start in UTC, used by the Stock banner's
"Certs emitidos esta semana" card to bound the /api/certificates
query window. Pure function; no Intl, no locale concerns.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `lib/api/orders.ts` Server Actions

**Why:** Two reads the page uses heavily: `listOrders` (paginated table) and `getOrdersStats` (banner). Same `rethrowWithMessage` pattern as `lib/api/batches.ts:13` so back error messages reach the client unmasked.

**Files:**
- Create: `lib/api/orders.ts`
- Create: `lib/api/orders.test.ts`

- [ ] **Step 1: Write failing test**

Create `/Users/llam/dev/araguaney_front/lib/api/orders.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listOrders, getOrdersStats } from './orders';

const mockApiFetch = vi.fn();
vi.mock('./client', () => ({
  apiFetch: (path: string, init?: RequestInit) => mockApiFetch(path, init),
  ApiError: class ApiError extends Error {},
}));

describe('listOrders', () => {
  beforeEach(() => vi.clearAllMocks());

  it('GETs /api/orders with limit + offset when no filters', async () => {
    mockApiFetch.mockResolvedValueOnce({ data: [], total: 0, limit: 50, offset: 0 });
    await listOrders({ limit: 50, offset: 0 });
    expect(mockApiFetch).toHaveBeenCalledWith('/api/orders?limit=50&offset=0', { method: 'GET' });
  });

  it('appends every supported filter to the query string', async () => {
    mockApiFetch.mockResolvedValueOnce({ data: [], total: 0, limit: 50, offset: 0 });
    await listOrders({
      limit: 50,
      offset: 0,
      status: 'available',
      merchant_id: 'm-1',
      max_due_date_lte: '2026-05-31',
      q: '8565',
      sort: 'purchase_date_desc',
    });
    const path = mockApiFetch.mock.calls[0][0] as string;
    expect(path).toContain('status=available');
    expect(path).toContain('merchant_id=m-1');
    expect(path).toContain('max_due_date_lte=2026-05-31');
    expect(path).toContain('q=8565');
    expect(path).toContain('sort=purchase_date_desc');
  });

  it('returns the parsed response unchanged', async () => {
    const expected = {
      data: [{ id: 'o-1', external_order_id: 'ORD-1' }],
      total: 1,
      limit: 50,
      offset: 0,
    };
    mockApiFetch.mockResolvedValueOnce(expected);
    const result = await listOrders({ limit: 50, offset: 0 });
    expect(result).toEqual(expected);
  });
});

describe('getOrdersStats', () => {
  beforeEach(() => vi.clearAllMocks());

  it('GETs /api/orders/stats with no params', async () => {
    mockApiFetch.mockResolvedValueOnce({
      by_status: {
        available: { count: 0, total_amount: '0', total_installments_amount: '0' },
        assigned: { count: 0, total_amount: '0', total_installments_amount: '0' },
        matured: { count: 0, total_amount: '0', total_installments_amount: '0' },
        defaulted: { count: 0, total_amount: '0', total_installments_amount: '0' },
      },
      total_orders: 0,
      available_capital: '0',
    });
    await getOrdersStats();
    expect(mockApiFetch).toHaveBeenCalledWith('/api/orders/stats', { method: 'GET' });
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/api/orders.test.ts
```

Expected: FAIL — `./orders` doesn't exist.

- [ ] **Step 3: Implement `lib/api/orders.ts`**

Create `/Users/llam/dev/araguaney_front/lib/api/orders.ts`:

```ts
'use server';

import { apiFetch } from './client';
import { ApiError } from './error';
import type { OrdersListResponse, OrdersStats, OrderStatus } from '@/lib/types/order';

function rethrowWithMessage(err: unknown): never {
  if (err instanceof ApiError) {
    const body = err.body as { message?: string } | null;
    throw new Error(body?.message ?? `Error del servidor (${err.status})`);
  }
  throw err;
}

export interface ListOrdersQuery {
  limit?: number;
  offset?: number;
  status?: OrderStatus;
  merchant_id?: string;
  max_due_date_lte?: string;
  q?: string;
  sort?: 'purchase_date_desc' | 'purchase_date_asc' | 'max_due_date_asc' | 'max_due_date_desc';
}

export async function listOrders(query: ListOrdersQuery = {}): Promise<OrdersListResponse> {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.offset !== undefined) params.set('offset', String(query.offset));
  if (query.status) params.set('status', query.status);
  if (query.merchant_id) params.set('merchant_id', query.merchant_id);
  if (query.max_due_date_lte) params.set('max_due_date_lte', query.max_due_date_lte);
  if (query.q) params.set('q', query.q);
  if (query.sort) params.set('sort', query.sort);
  const qs = params.toString();
  try {
    return await apiFetch<OrdersListResponse>(`/api/orders${qs ? '?' + qs : ''}`, {
      method: 'GET',
    });
  } catch (err) {
    rethrowWithMessage(err);
  }
}

export async function getOrdersStats(): Promise<OrdersStats> {
  try {
    return await apiFetch<OrdersStats>('/api/orders/stats', { method: 'GET' });
  } catch (err) {
    rethrowWithMessage(err);
  }
}
```

- [ ] **Step 4: Confirm tests pass**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/api/orders.test.ts
```

Expected: 4 tests green.

- [ ] **Step 5: Verify suite + format**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

Expected: all clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add lib/api/orders.ts lib/api/orders.test.ts
git commit -m "$(cat <<'EOF'
feat(api): listOrders + getOrdersStats Server Actions

Wraps GET /api/orders and GET /api/orders/stats. Same
rethrowWithMessage pattern as lib/api/batches.ts so back error
messages survive the Server Action RPC boundary.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `lib/api/merchants.ts`

**Why:** Stock filter dropdown needs the merchant list. Single endpoint call, mirror the orders.ts pattern.

**Files:**
- Create: `lib/api/merchants.ts`
- Create: `lib/api/merchants.test.ts`

- [ ] **Step 1: Write failing test**

Create `/Users/llam/dev/araguaney_front/lib/api/merchants.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listMerchants } from './merchants';

const mockApiFetch = vi.fn();
vi.mock('./client', () => ({
  apiFetch: (path: string, init?: RequestInit) => mockApiFetch(path, init),
  ApiError: class ApiError extends Error {},
}));

describe('listMerchants', () => {
  beforeEach(() => vi.clearAllMocks());

  it('GETs /api/merchants with limit + sort', async () => {
    mockApiFetch.mockResolvedValueOnce({ data: [], total: 0, limit: 200, offset: 0 });
    await listMerchants({ limit: 200, sort: 'name_asc' });
    expect(mockApiFetch).toHaveBeenCalledWith('/api/merchants?limit=200&sort=name_asc', {
      method: 'GET',
    });
  });

  it('returns the parsed response', async () => {
    const expected = {
      data: [{ id: 'm-1', rif: 'J-1', current_name: 'Mercantil', orders_count: 5 }],
      total: 1,
      limit: 200,
      offset: 0,
    };
    mockApiFetch.mockResolvedValueOnce(expected);
    const result = await listMerchants({ limit: 200 });
    expect(result).toEqual(expected);
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/api/merchants.test.ts
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `lib/api/merchants.ts`**

Create `/Users/llam/dev/araguaney_front/lib/api/merchants.ts`:

```ts
'use server';

import { apiFetch } from './client';
import { ApiError } from './error';
import type { MerchantsListResponse } from '@/lib/types/merchant';

function rethrowWithMessage(err: unknown): never {
  if (err instanceof ApiError) {
    const body = err.body as { message?: string } | null;
    throw new Error(body?.message ?? `Error del servidor (${err.status})`);
  }
  throw err;
}

export interface ListMerchantsQuery {
  limit?: number;
  offset?: number;
  sort?: 'name_asc' | 'name_desc' | 'orders_desc';
}

export async function listMerchants(
  query: ListMerchantsQuery = {},
): Promise<MerchantsListResponse> {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.offset !== undefined) params.set('offset', String(query.offset));
  if (query.sort) params.set('sort', query.sort);
  const qs = params.toString();
  try {
    return await apiFetch<MerchantsListResponse>(`/api/merchants${qs ? '?' + qs : ''}`, {
      method: 'GET',
    });
  } catch (err) {
    rethrowWithMessage(err);
  }
}
```

- [ ] **Step 4: Confirm tests pass**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/api/merchants.test.ts
```

Expected: 2 tests green.

- [ ] **Step 5: Verify suite**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

Expected: all clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add lib/api/merchants.ts lib/api/merchants.test.ts
git commit -m "$(cat <<'EOF'
feat(api): listMerchants Server Action

Wraps GET /api/merchants. Used by Stock filters dropdown.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `lib/api/certificates.ts`

**Why:** Banner card 3 ("Certs emitidos esta semana") needs only the count, not the full list. Pass `?limit=1` and read `total` from the response.

**Files:**
- Create: `lib/api/certificates.ts`
- Create: `lib/api/certificates.test.ts`

- [ ] **Step 1: Write failing test**

Create `/Users/llam/dev/araguaney_front/lib/api/certificates.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { countCertificatesIssued } from './certificates';

const mockApiFetch = vi.fn();
vi.mock('./client', () => ({
  apiFetch: (path: string, init?: RequestInit) => mockApiFetch(path, init),
  ApiError: class ApiError extends Error {},
}));

describe('countCertificatesIssued', () => {
  beforeEach(() => vi.clearAllMocks());

  it('GETs /api/certificates with issue_date range and limit=1', async () => {
    mockApiFetch.mockResolvedValueOnce({ data: [], total: 7, limit: 1, offset: 0 });
    await countCertificatesIssued('2026-05-04', '2026-05-08');
    const path = mockApiFetch.mock.calls[0][0] as string;
    expect(path).toContain('issue_date_from=2026-05-04');
    expect(path).toContain('issue_date_to=2026-05-08');
    expect(path).toContain('limit=1');
  });

  it('returns just the total count', async () => {
    mockApiFetch.mockResolvedValueOnce({ data: [], total: 12, limit: 1, offset: 0 });
    const result = await countCertificatesIssued('2026-05-04', '2026-05-08');
    expect(result).toEqual({ total: 12 });
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/api/certificates.test.ts
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `lib/api/certificates.ts`**

Create `/Users/llam/dev/araguaney_front/lib/api/certificates.ts`:

```ts
'use server';

import { apiFetch } from './client';
import { ApiError } from './error';

interface CertificatesListResponse {
  data: unknown[];
  total: number;
  limit: number;
  offset: number;
}

function rethrowWithMessage(err: unknown): never {
  if (err instanceof ApiError) {
    const body = err.body as { message?: string } | null;
    throw new Error(body?.message ?? `Error del servidor (${err.status})`);
  }
  throw err;
}

/**
 * Returns only the count of certificates issued between [from, to].
 * The Stock banner card cares about the number, not the certificates.
 * `from` and `to` are ISO date strings (YYYY-MM-DD).
 */
export async function countCertificatesIssued(
  from: string,
  to: string,
): Promise<{ total: number }> {
  const params = new URLSearchParams({
    issue_date_from: from,
    issue_date_to: to,
    limit: '1',
  });
  try {
    const res = await apiFetch<CertificatesListResponse>(`/api/certificates?${params.toString()}`, {
      method: 'GET',
    });
    return { total: res.total };
  } catch (err) {
    rethrowWithMessage(err);
  }
}
```

- [ ] **Step 4: Confirm tests pass**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/api/certificates.test.ts
```

Expected: 2 tests green.

- [ ] **Step 5: Verify suite**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

Expected: all clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add lib/api/certificates.ts lib/api/certificates.test.ts
git commit -m "$(cat <<'EOF'
feat(api): countCertificatesIssued Server Action

Hits GET /api/certificates with limit=1 and returns just the total.
Stock banner card 3 ("Certs emitidos esta semana") consumes this.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `<Pill>` `danger` variant + `<OrderStatusPill>`

**Why:** Order's `defaulted` status needs a red tone the existing Pill doesn't expose. Single small extension to the primitive plus a new wrapper.

**Files:**
- Modify: `components/ui/pill.tsx`
- Modify: `components/ui/pill.test.tsx`
- Create: `components/stock/order-status-pill.tsx`
- Create: `components/stock/order-status-pill.test.tsx`

- [ ] **Step 1: Extend Pill test for the new variant**

Read existing `components/ui/pill.test.tsx` and locate the `it.each(...)` block iterating variants. Add a row for `danger`. The expected snippet:

Open `/Users/llam/dev/araguaney_front/components/ui/pill.test.tsx` and replace the variants array literal so it includes `'danger'`. Concretely, find the block matching `[ 'success', 'warn', 'info', 'neutral', 'sweep' ]` (or equivalent enumeration) and add `'danger'`.

If the test file uses `it.each` with explicit cases, add:

```ts
it('renders the danger variant with rose colors', () => {
  const { container } = render(<Pill variant="danger">Defaulteada</Pill>);
  const span = container.querySelector('span');
  expect(span?.className).toContain('bg-rose-100');
  expect(span?.className).toContain('text-rose-700');
});
```

If `it.each` over a tuple array, append `['danger', 'bg-rose-100', 'text-rose-700']` (or whatever the existing tuple shape is) and re-run.

- [ ] **Step 2: Run, confirm Pill test fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/ui/pill.test.tsx
```

Expected: FAIL — `danger` not in `PillVariant` type / `VARIANT_CLASSES` map.

- [ ] **Step 3: Add `danger` to `components/ui/pill.tsx`**

Edit `/Users/llam/dev/araguaney_front/components/ui/pill.tsx`. Replace the `PillVariant`, `VARIANT_CLASSES`, and `DOT_CLASSES` blocks with:

```ts
export type PillVariant = 'success' | 'warn' | 'info' | 'neutral' | 'sweep' | 'danger';

const VARIANT_CLASSES: Record<PillVariant, string> = {
  success: 'bg-green-bg text-green-text',
  warn: 'bg-warn-bg text-warn-text',
  info: 'bg-info-bg text-info-text',
  neutral: 'bg-neutral-bg text-neutral-text',
  sweep: 'bg-sweep-bg text-sweep-text border border-dashed border-sweep-border',
  danger: 'bg-rose-100 text-rose-700',
};

const DOT_CLASSES: Record<PillVariant, string> = {
  success: 'bg-green-dot',
  warn: 'bg-warn-dot',
  info: 'bg-info-text',
  neutral: 'bg-text-3',
  sweep: 'bg-sweep-dot',
  danger: 'bg-rose-500',
};
```

(Tailwind ships rose-100/500/700 by default; no design-token additions needed.)

- [ ] **Step 4: Confirm Pill test passes**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/ui/pill.test.tsx
```

Expected: all variants green including `danger`.

- [ ] **Step 5: Write failing test for `<OrderStatusPill>`**

Create `/Users/llam/dev/araguaney_front/components/stock/order-status-pill.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { OrderStatusPill } from './order-status-pill';

describe('<OrderStatusPill />', () => {
  it('shows "Disponible" with success tone for available', () => {
    const { container, getByText } = render(<OrderStatusPill status="available" />);
    expect(getByText('Disponible')).toBeInTheDocument();
    expect(container.querySelector('span')?.className).toContain('bg-green-bg');
  });

  it('shows "Asignada" with warn tone for assigned', () => {
    const { container, getByText } = render(<OrderStatusPill status="assigned" />);
    expect(getByText('Asignada')).toBeInTheDocument();
    expect(container.querySelector('span')?.className).toContain('bg-warn-bg');
  });

  it('shows "Vencida" with neutral tone for matured', () => {
    const { container, getByText } = render(<OrderStatusPill status="matured" />);
    expect(getByText('Vencida')).toBeInTheDocument();
    expect(container.querySelector('span')?.className).toContain('bg-neutral-bg');
  });

  it('shows "Defaulteada" with danger tone for defaulted', () => {
    const { container, getByText } = render(<OrderStatusPill status="defaulted" />);
    expect(getByText('Defaulteada')).toBeInTheDocument();
    expect(container.querySelector('span')?.className).toContain('bg-rose-100');
  });
});
```

- [ ] **Step 6: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/stock/order-status-pill.test.tsx
```

Expected: FAIL — `./order-status-pill` not found.

- [ ] **Step 7: Implement `<OrderStatusPill>`**

Create `/Users/llam/dev/araguaney_front/components/stock/order-status-pill.tsx`:

```tsx
import { Pill, type PillVariant } from '@/components/ui/pill';
import type { OrderStatus } from '@/lib/types/order';

const MAP: Record<OrderStatus, { variant: PillVariant; label: string }> = {
  available: { variant: 'success', label: 'Disponible' },
  assigned: { variant: 'warn', label: 'Asignada' },
  matured: { variant: 'neutral', label: 'Vencida' },
  defaulted: { variant: 'danger', label: 'Defaulteada' },
};

export function OrderStatusPill({ status }: { status: OrderStatus }) {
  const m = MAP[status];
  return <Pill variant={m.variant}>{m.label}</Pill>;
}
```

- [ ] **Step 8: Confirm tests pass**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/stock/order-status-pill.test.tsx
```

Expected: 4 tests green.

- [ ] **Step 9: Verify suite**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

Expected: all clean.

- [ ] **Step 10: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/ui/pill.tsx components/ui/pill.test.tsx \
        components/stock/order-status-pill.tsx components/stock/order-status-pill.test.tsx
git commit -m "$(cat <<'EOF'
feat(stock): OrderStatusPill + Pill 'danger' variant

Adds rose-toned 'danger' variant to the Pill primitive (used for the
'defaulted' OrderStatus) and a thin status→variant+Spanish-label
wrapper component.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `<OrderRow>`

**Why:** Single-row component keeps the table clean and makes per-row formatting trivially testable.

**Files:**
- Create: `components/stock/order-row.tsx`
- Create: `components/stock/order-row.test.tsx`

- [ ] **Step 1: Write failing test**

Create `/Users/llam/dev/araguaney_front/components/stock/order-row.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { OrderRow } from './order-row';
import type { OrderSummary } from '@/lib/types/order';

function mockOrder(overrides: Partial<OrderSummary> = {}): OrderSummary {
  return {
    id: 'o-1',
    external_order_id: '85657474',
    status: 'available',
    purchase_date: '2026-03-18',
    max_due_date: '2026-04-03',
    total_amount: '87.2400',
    installments_sum: '87.2400',
    num_installments: 3,
    imported_at: '2026-05-08T18:15:00Z',
    merchant: { id: 'm-1', current_name: 'CENTRAL MADEIRENSE, C.A', rif: 'J-12345678-9' },
    end_user: { id: 'eu-1', external_hash: 'h', national_id: null, full_name: null },
    batch: { id: 'b-1', external_code: 'B-1' },
    ...overrides,
  };
}

describe('<OrderRow />', () => {
  function wrap(row: React.ReactElement) {
    return render(
      <table>
        <tbody>{row}</tbody>
      </table>,
    );
  }

  it('renders all columns with formatted values', () => {
    const { getByText } = wrap(<OrderRow order={mockOrder()} />);
    expect(getByText('85657474')).toBeInTheDocument();
    expect(getByText('18/03/2026')).toBeInTheDocument();
    expect(getByText('CENTRAL MADEIRENSE, C.A')).toBeInTheDocument();
    expect(getByText('3')).toBeInTheDocument();
    expect(getByText('$87.24')).toBeInTheDocument();
    expect(getByText('Disponible')).toBeInTheDocument();
  });

  it('formats integer amounts with no decimals only when an integer', () => {
    const { getByText } = wrap(
      <OrderRow order={mockOrder({ installments_sum: '300.0000' })} />,
    );
    // 300 is integer → "$300", but Decimal-as-string parses to 300 → fmtMoney(300) → "$300"
    expect(getByText('$300')).toBeInTheDocument();
  });

  it('passes the right status to OrderStatusPill', () => {
    const { getByText } = wrap(<OrderRow order={mockOrder({ status: 'matured' })} />);
    expect(getByText('Vencida')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/stock/order-row.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement `<OrderRow>`**

Create `/Users/llam/dev/araguaney_front/components/stock/order-row.tsx`:

```tsx
import { fmtDate } from '@/lib/format/date';
import { fmtMoney } from '@/lib/format/money';
import type { OrderSummary } from '@/lib/types/order';
import { OrderStatusPill } from './order-status-pill';

export function OrderRow({ order }: { order: OrderSummary }) {
  return (
    <tr className="border-border-soft hover:bg-subtle border-b transition-colors">
      <td className="text-text-2 px-4 py-3.5 font-mono text-[11.5px]">{order.external_order_id}</td>
      <td className="num px-4 py-3.5">{fmtDate(order.purchase_date)}</td>
      <td className="max-w-[280px] truncate px-4 py-3.5" title={order.merchant.current_name}>
        {order.merchant.current_name}
      </td>
      <td className="num px-4 py-3.5 text-right font-medium">{order.num_installments}</td>
      <td className="num px-4 py-3.5 text-right font-medium">
        {fmtMoney(Number(order.installments_sum))}
      </td>
      <td className="px-4 py-3.5">
        <OrderStatusPill status={order.status} />
      </td>
    </tr>
  );
}
```

- [ ] **Step 4: Confirm tests pass**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/stock/order-row.test.tsx
```

Expected: 3 tests green.

- [ ] **Step 5: Verify suite**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

Expected: all clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/stock/order-row.tsx components/stock/order-row.test.tsx
git commit -m "$(cat <<'EOF'
feat(stock): OrderRow component

Renders one order in the Stock table with formatted code, date,
truncated merchant (with title tooltip), num cuotas, monto, and
status pill.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `<StockStatsBanner>`

**Why:** Three stat cards above the table. Owns the queries for orders-stats and certs-this-week.

**Files:**
- Create: `components/stock/stock-stats-banner.tsx`
- Create: `components/stock/stock-stats-banner.test.tsx`

- [ ] **Step 1: Write failing test**

Create `/Users/llam/dev/araguaney_front/components/stock/stock-stats-banner.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithQuery } from '@/test/helpers/tanstack';
import { StockStatsBanner } from './stock-stats-banner';

const { mockGetOrdersStats, mockCountCerts } = vi.hoisted(() => ({
  mockGetOrdersStats: vi.fn(),
  mockCountCerts: vi.fn(),
}));

vi.mock('@/lib/api/orders', () => ({
  getOrdersStats: () => mockGetOrdersStats(),
}));

vi.mock('@/lib/api/certificates', () => ({
  countCertificatesIssued: (from: string, to: string) => mockCountCerts(from, to),
}));

describe('<StockStatsBanner />', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading placeholders while fetching', () => {
    mockGetOrdersStats.mockImplementation(() => new Promise(() => {}));
    mockCountCerts.mockImplementation(() => new Promise(() => {}));
    renderWithQuery(<StockStatsBanner />);
    // 3 cards each render a "—" placeholder while loading
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('renders capital + count + certs-this-week values on success', async () => {
    mockGetOrdersStats.mockResolvedValueOnce({
      by_status: {
        available: { count: 17794, total_amount: '0', total_installments_amount: '927913.3433' },
        assigned: { count: 0, total_amount: '0', total_installments_amount: '0' },
        matured: { count: 0, total_amount: '0', total_installments_amount: '0' },
        defaulted: { count: 0, total_amount: '0', total_installments_amount: '0' },
      },
      total_orders: 17794,
      available_capital: '927913.3433',
    });
    mockCountCerts.mockResolvedValueOnce({ total: 7 });

    renderWithQuery(<StockStatsBanner />);

    await waitFor(() => expect(screen.getByText(/\$927,913/)).toBeInTheDocument());
    expect(screen.getByText('17,794')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('shows "—" if orders-stats fails but cert card still renders', async () => {
    mockGetOrdersStats.mockRejectedValueOnce(new Error('boom'));
    mockCountCerts.mockResolvedValueOnce({ total: 3 });

    renderWithQuery(<StockStatsBanner />);

    await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument());
    // The two stats cards from orders-stats should show fallback dashes
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('passes Monday-of-this-week as issue_date_from to the certs query', async () => {
    mockGetOrdersStats.mockResolvedValueOnce({
      by_status: {
        available: { count: 0, total_amount: '0', total_installments_amount: '0' },
        assigned: { count: 0, total_amount: '0', total_installments_amount: '0' },
        matured: { count: 0, total_amount: '0', total_installments_amount: '0' },
        defaulted: { count: 0, total_amount: '0', total_installments_amount: '0' },
      },
      total_orders: 0,
      available_capital: '0',
    });
    mockCountCerts.mockResolvedValueOnce({ total: 0 });

    renderWithQuery(<StockStatsBanner />);

    await waitFor(() => expect(mockCountCerts).toHaveBeenCalled());
    const [from, to] = mockCountCerts.mock.calls[0];
    expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(from <= to).toBe(true);
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/stock/stock-stats-banner.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement `<StockStatsBanner>`**

Create `/Users/llam/dev/araguaney_front/components/stock/stock-stats-banner.tsx`:

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { getOrdersStats } from '@/lib/api/orders';
import { countCertificatesIssued } from '@/lib/api/certificates';
import { mondayOfThisWeekUTC, todayUTC } from '@/lib/format/week';
import { fmtMoney2 } from '@/lib/format/money';

export function StockStatsBanner() {
  const stats = useQuery({
    queryKey: ['orders-stats'],
    queryFn: () => getOrdersStats(),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const monday = mondayOfThisWeekUTC();
  const today = todayUTC();
  const certs = useQuery({
    queryKey: ['certs-this-week', monday, today],
    queryFn: () => countCertificatesIssued(monday, today),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const capitalValue =
    stats.isSuccess ? fmtMoney2(Number(stats.data.available_capital)) : '—';
  const ordersValue =
    stats.isSuccess ? stats.data.by_status.available.count.toLocaleString('en-US') : '—';
  const certsValue = certs.isSuccess ? String(certs.data.total) : '—';

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <Card label="Capital disponible" value={capitalValue} sub="nominal disponible" />
      <Card label="Órdenes disponibles" value={ordersValue} sub="disponibles para emisión" />
      <Card
        label="Certs esta semana"
        value={certsValue}
        sub={`desde lun ${formatMondayShort(monday)}`}
      />
    </div>
  );
}

function Card({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-card border-border-subtle rounded-lg border p-4">
      <div className="text-text-3 text-[10px] tracking-wide uppercase">{label}</div>
      <div className="mt-1 text-[20px] font-semibold tabular-nums tracking-[-0.3px]">{value}</div>
      <div className="text-text-3 mt-0.5 text-[11px]">{sub}</div>
    </div>
  );
}

function formatMondayShort(iso: string): string {
  // "2026-05-04" → "04/05"
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}
```

- [ ] **Step 4: Confirm tests pass**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/stock/stock-stats-banner.test.tsx
```

Expected: 4 tests green.

- [ ] **Step 5: Verify suite**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

Expected: all clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/stock/stock-stats-banner.tsx components/stock/stock-stats-banner.test.tsx
git commit -m "$(cat <<'EOF'
feat(stock): StockStatsBanner component

Three-card grid wired to /api/orders/stats (capital + orders count)
and /api/certificates filtered to this-week's emisiones. Failures on
either endpoint degrade gracefully to em-dash placeholders.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `<StockFilters>`

**Why:** Single component owning the four filter widgets. Stateless — receives `value` + `onChange` from `<StockPage>`.

**Files:**
- Create: `components/stock/stock-filters.tsx`
- Create: `components/stock/stock-filters.test.tsx`

- [ ] **Step 1: Write failing test**

Create `/Users/llam/dev/araguaney_front/components/stock/stock-filters.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/test/helpers/tanstack';
import { StockFilters, type StockFiltersValue } from './stock-filters';

const { mockListMerchants } = vi.hoisted(() => ({ mockListMerchants: vi.fn() }));

vi.mock('@/lib/api/merchants', () => ({
  listMerchants: (...a: unknown[]) => mockListMerchants(...a),
}));

const DEFAULT_VALUE: StockFiltersValue = {
  status: 'available',
  merchantId: null,
  maxDueDateLte: null,
  q: '',
};

describe('<StockFilters />', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListMerchants.mockResolvedValue({
      data: [
        { id: 'm-1', rif: 'J-1', current_name: 'Mercantil C.A.', orders_count: 5 },
        { id: 'm-2', rif: 'J-2', current_name: 'Bodegón XYZ', orders_count: 3 },
      ],
      total: 2,
      limit: 200,
      offset: 0,
    });
  });

  it('renders the four status pills with "Disponibles" active by default', () => {
    renderWithQuery(<StockFilters value={DEFAULT_VALUE} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Disponibles' })).toHaveAttribute(
      'data-active',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Todas' })).toHaveAttribute('data-active', 'false');
  });

  it('emits onChange with status="all" → undefined when "Todas" is clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithQuery(<StockFilters value={DEFAULT_VALUE} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Todas' }));
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_VALUE, status: 'all' });
  });

  it('emits onChange with merchantId when a merchant is selected', async () => {
    const onChange = vi.fn();
    renderWithQuery(<StockFilters value={DEFAULT_VALUE} onChange={onChange} />);
    await waitFor(() => expect(mockListMerchants).toHaveBeenCalled());
    const select = await screen.findByLabelText(/comercio/i);
    fireEvent.change(select, { target: { value: 'm-1' } });
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_VALUE, merchantId: 'm-1' });
  });

  it('emits onChange with maxDueDateLte when the date input changes', () => {
    const onChange = vi.fn();
    renderWithQuery(<StockFilters value={DEFAULT_VALUE} onChange={onChange} />);
    const input = screen.getByLabelText(/vence antes/i);
    fireEvent.change(input, { target: { value: '2026-05-31' } });
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_VALUE, maxDueDateLte: '2026-05-31' });
  });

  it('debounces the search input by 300ms before emitting onChange.q', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    renderWithQuery(<StockFilters value={DEFAULT_VALUE} onChange={onChange} />);
    const input = screen.getByPlaceholderText(/c[oó]digo/i);
    fireEvent.change(input, { target: { value: '8565' } });
    // Before debounce fires
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(310);
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_VALUE, q: '8565' });
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/stock/stock-filters.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement `<StockFilters>`**

Create `/Users/llam/dev/araguaney_front/components/stock/stock-filters.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listMerchants } from '@/lib/api/merchants';
import type { OrderStatus } from '@/lib/types/order';

export type StockStatusFilter = OrderStatus | 'all';

export interface StockFiltersValue {
  status: StockStatusFilter;
  merchantId: string | null;
  maxDueDateLte: string | null; // YYYY-MM-DD
  q: string;
}

interface Props {
  value: StockFiltersValue;
  onChange: (next: StockFiltersValue) => void;
}

const STATUS_OPTIONS: Array<{ value: StockStatusFilter; label: string }> = [
  { value: 'available', label: 'Disponibles' },
  { value: 'all', label: 'Todas' },
  { value: 'assigned', label: 'Asignadas' },
  { value: 'matured', label: 'Vencidas' },
];

export function StockFilters({ value, onChange }: Props) {
  // Local search input state with debounce
  const [qLocal, setQLocal] = useState(value.q);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (qLocal === value.q) return;
    debounceRef.current = setTimeout(() => {
      onChange({ ...value, q: qLocal });
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [qLocal, value, onChange]);

  const merchants = useQuery({
    queryKey: ['merchants'],
    queryFn: () => listMerchants({ limit: 200, sort: 'name_asc' }),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  return (
    <div className="flex flex-col gap-3">
      {/* Row 1: status pills + search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="border-border-subtle flex items-center gap-1 rounded-md border p-1">
          {STATUS_OPTIONS.map((opt) => {
            const active = value.status === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                data-active={active}
                onClick={() => onChange({ ...value, status: opt.value })}
                className={
                  'rounded px-3 py-1 text-[12px] font-medium transition-colors ' +
                  (active
                    ? 'bg-foreground text-background'
                    : 'text-text-2 hover:bg-subtle')
                }
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <input
          type="search"
          placeholder="🔎 Código de orden"
          value={qLocal}
          onChange={(e) => setQLocal(e.target.value)}
          className="border-border-subtle w-64 rounded-md border bg-card px-3 py-1.5 text-[12px]"
        />
      </div>

      {/* Row 2: comercio + max-due-date */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[11px]">
          <span className="text-text-3">Comercio</span>
          <select
            aria-label="Comercio"
            value={value.merchantId ?? ''}
            onChange={(e) =>
              onChange({ ...value, merchantId: e.target.value === '' ? null : e.target.value })
            }
            className="border-border-subtle rounded-md border bg-card px-2 py-1 text-[12px]"
            disabled={merchants.isLoading}
          >
            <option value="">Todos</option>
            {merchants.data?.data.map((m) => (
              <option key={m.id} value={m.id}>
                {m.current_name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-[11px]">
          <span className="text-text-3">Vence antes de</span>
          <input
            type="date"
            aria-label="Vence antes de"
            value={value.maxDueDateLte ?? ''}
            onChange={(e) =>
              onChange({
                ...value,
                maxDueDateLte: e.target.value === '' ? null : e.target.value,
              })
            }
            className="border-border-subtle rounded-md border bg-card px-2 py-1 text-[12px]"
          />
        </label>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Confirm tests pass**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/stock/stock-filters.test.tsx
```

Expected: 5 tests green.

- [ ] **Step 5: Verify suite**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

Expected: all clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/stock/stock-filters.tsx components/stock/stock-filters.test.tsx
git commit -m "$(cat <<'EOF'
feat(stock): StockFilters component

Stateless 4-filter row (status pills, comercio dropdown,
vence-antes-de, debounced código search). Owns its own debounce
internal state for the search input; everything else is lifted up
to the parent via onChange.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: `<StockTable>` with pagination

**Why:** The table itself, with TanStack `useQuery` keyed by `[filters, page]`. Pagination footer is part of this component (lives with the data it pages).

**Files:**
- Create: `components/stock/stock-table.tsx`
- Create: `components/stock/stock-table.test.tsx`

- [ ] **Step 1: Write failing test**

Create `/Users/llam/dev/araguaney_front/components/stock/stock-table.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithQuery } from '@/test/helpers/tanstack';
import { StockTable } from './stock-table';
import type { StockFiltersValue } from './stock-filters';
import type { OrderSummary } from '@/lib/types/order';

const { mockListOrders } = vi.hoisted(() => ({ mockListOrders: vi.fn() }));

vi.mock('@/lib/api/orders', () => ({
  listOrders: (...a: unknown[]) => mockListOrders(...a),
}));

function order(overrides: Partial<OrderSummary> = {}): OrderSummary {
  return {
    id: 'o-' + Math.random(),
    external_order_id: '85657474',
    status: 'available',
    purchase_date: '2026-03-18',
    max_due_date: '2026-04-03',
    total_amount: '87.2400',
    installments_sum: '87.2400',
    num_installments: 3,
    imported_at: '2026-05-08T18:15:00Z',
    merchant: { id: 'm-1', current_name: 'CENTRAL MADEIRENSE, C.A', rif: 'J-1' },
    end_user: { id: 'eu-1', external_hash: 'h', national_id: null, full_name: null },
    batch: { id: 'b-1', external_code: 'B-1' },
    ...overrides,
  };
}

const FILTERS: StockFiltersValue = {
  status: 'available',
  merchantId: null,
  maxDueDateLte: null,
  q: '',
};

describe('<StockTable />', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows skeleton while fetching', () => {
    mockListOrders.mockImplementation(() => new Promise(() => {}));
    renderWithQuery(<StockTable filters={FILTERS} page={0} onPageChange={() => {}} />);
    expect(screen.getByText(/cargando/i)).toBeInTheDocument();
  });

  it('shows empty state when filters return zero results', async () => {
    mockListOrders.mockResolvedValueOnce({ data: [], total: 0, limit: 50, offset: 0 });
    renderWithQuery(<StockTable filters={FILTERS} page={0} onPageChange={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText(/ning[uú]n resultado/i)).toBeInTheDocument(),
    );
  });

  it('shows error state with retry button on failure', async () => {
    mockListOrders.mockRejectedValueOnce(new Error('boom'));
    renderWithQuery(<StockTable filters={FILTERS} page={0} onPageChange={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText(/no se pudieron cargar/i)).toBeInTheDocument(),
    );
  });

  it('renders rows + pagination footer when data arrives', async () => {
    mockListOrders.mockResolvedValueOnce({
      data: [order({ external_order_id: 'A' }), order({ external_order_id: 'B' })],
      total: 100,
      limit: 50,
      offset: 0,
    });
    renderWithQuery(<StockTable filters={FILTERS} page={0} onPageChange={() => {}} />);
    await waitFor(() => expect(screen.getByText('A')).toBeInTheDocument());
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText(/1[–\-]50 de 100/)).toBeInTheDocument();
  });

  it('translates filter status="all" into no status param when calling listOrders', async () => {
    mockListOrders.mockResolvedValueOnce({ data: [], total: 0, limit: 50, offset: 0 });
    renderWithQuery(
      <StockTable
        filters={{ ...FILTERS, status: 'all' }}
        page={0}
        onPageChange={() => {}}
      />,
    );
    await waitFor(() => expect(mockListOrders).toHaveBeenCalled());
    const args = mockListOrders.mock.calls[0][0];
    expect(args.status).toBeUndefined();
  });

  it('triggers onPageChange when the next-page button is clicked', async () => {
    mockListOrders.mockResolvedValueOnce({
      data: [order()],
      total: 200,
      limit: 50,
      offset: 0,
    });
    const onPageChange = vi.fn();
    renderWithQuery(<StockTable filters={FILTERS} page={0} onPageChange={onPageChange} />);
    await waitFor(() => expect(screen.getByLabelText(/p[aá]gina siguiente/i)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/p[aá]gina siguiente/i));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/stock/stock-table.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement `<StockTable>`**

Create `/Users/llam/dev/araguaney_front/components/stock/stock-table.tsx`:

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { listOrders, type ListOrdersQuery } from '@/lib/api/orders';
import type { StockFiltersValue } from './stock-filters';
import { OrderRow } from './order-row';

const PAGE_LIMIT = 50;

interface Props {
  filters: StockFiltersValue;
  page: number;
  onPageChange: (next: number) => void;
}

function buildQuery(filters: StockFiltersValue, page: number): ListOrdersQuery {
  return {
    limit: PAGE_LIMIT,
    offset: page * PAGE_LIMIT,
    status: filters.status === 'all' ? undefined : filters.status,
    merchant_id: filters.merchantId ?? undefined,
    max_due_date_lte: filters.maxDueDateLte ?? undefined,
    q: filters.q || undefined,
    sort: 'purchase_date_desc',
  };
}

export function StockTable({ filters, page, onPageChange }: Props) {
  const query = buildQuery(filters, page);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['orders', query],
    queryFn: () => listOrders(query),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });

  if (isLoading) return <Skeleton />;
  if (isError) return <ErrorState onRetry={() => refetch()} />;
  if (!data || data.data.length === 0) return <EmptyState />;

  const start = data.offset + 1;
  const end = Math.min(data.offset + data.limit, data.total);
  const hasPrev = page > 0;
  const hasNext = data.offset + data.limit < data.total;

  return (
    <div className="bg-card border-border-subtle overflow-hidden rounded-xl border">
      <table className="w-full text-[12.5px]">
        <thead className="bg-subtle">
          <tr>
            <Th>Código</Th>
            <Th>Fecha</Th>
            <Th>Comercio</Th>
            <Th align="right">Cuotas</Th>
            <Th align="right">Monto</Th>
            <Th>Estado</Th>
          </tr>
        </thead>
        <tbody>
          {data.data.map((o) => (
            <OrderRow key={o.id} order={o} />
          ))}
        </tbody>
      </table>
      <div className="border-border-subtle flex items-center justify-between border-t px-4 py-3 text-[11.5px]">
        <span className="text-text-3 tabular-nums">
          Mostrando {start}–{end} de {data.total.toLocaleString('en-US')}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Página anterior"
            disabled={!hasPrev}
            onClick={() => onPageChange(page - 1)}
            className="border-border-subtle rounded border px-2 py-1 text-[11px] disabled:opacity-40"
          >
            ←
          </button>
          <button
            type="button"
            aria-label="Página siguiente"
            disabled={!hasNext}
            onClick={() => onPageChange(page + 1)}
            className="border-border-subtle rounded border px-2 py-1 text-[11px] disabled:opacity-40"
          >
            →
          </button>
        </div>
      </div>
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  const alignClass = align === 'right' ? 'text-right' : 'text-left';
  return (
    <th
      className={`text-text-3 border-border-subtle border-b px-4 py-2.5 ${alignClass} text-[9.5px] font-medium tracking-[0.7px] uppercase`}
    >
      {children}
    </th>
  );
}

function Skeleton() {
  return (
    <div className="border-border-subtle bg-card flex h-64 items-center justify-center rounded-xl border">
      <div className="text-text-3 text-sm">Cargando órdenes…</div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="border-border-subtle bg-card flex h-64 flex-col items-center justify-center gap-3 rounded-xl border">
      <div className="text-text-3 text-sm">No se pudieron cargar las órdenes.</div>
      <button
        type="button"
        onClick={onRetry}
        className="border-border-subtle rounded border px-3 py-1 text-[12px]"
      >
        Reintentar
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="border-border-subtle bg-card flex h-64 items-center justify-center rounded-xl border">
      <div className="text-text-3 text-center text-sm">
        Ningún resultado para los filtros aplicados. Probá ajustarlos.
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Confirm tests pass**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/stock/stock-table.test.tsx
```

Expected: 6 tests green.

- [ ] **Step 5: Verify suite**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

Expected: all clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/stock/stock-table.tsx components/stock/stock-table.test.tsx
git commit -m "$(cat <<'EOF'
feat(stock): StockTable component with pagination

Wraps useQuery(['orders', query]) with proper loading/empty/error
states (the error has a retry button) and a 50-per-page footer with
prev/next disabled at boundaries. status='all' is translated to no
status filter going to the back.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: `<StockPage>` orchestrator

**Why:** Owns the filter + page state and composes header + banner + filters + table.

**Files:**
- Create: `components/stock/stock-page.tsx`
- Create: `components/stock/stock-page.test.tsx`

- [ ] **Step 1: Write failing test**

Create `/Users/llam/dev/araguaney_front/components/stock/stock-page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithQuery } from '@/test/helpers/tanstack';
import { StockPage } from './stock-page';

const { mockListOrders, mockGetStats, mockCountCerts, mockListMerchants } = vi.hoisted(() => ({
  mockListOrders: vi.fn(),
  mockGetStats: vi.fn(),
  mockCountCerts: vi.fn(),
  mockListMerchants: vi.fn(),
}));

vi.mock('@/lib/api/orders', () => ({
  listOrders: (...a: unknown[]) => mockListOrders(...a),
  getOrdersStats: () => mockGetStats(),
}));

vi.mock('@/lib/api/certificates', () => ({
  countCertificatesIssued: (from: string, to: string) => mockCountCerts(from, to),
}));

vi.mock('@/lib/api/merchants', () => ({
  listMerchants: (...a: unknown[]) => mockListMerchants(...a),
}));

describe('<StockPage />', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStats.mockResolvedValue({
      by_status: {
        available: { count: 100, total_amount: '0', total_installments_amount: '5000' },
        assigned: { count: 0, total_amount: '0', total_installments_amount: '0' },
        matured: { count: 0, total_amount: '0', total_installments_amount: '0' },
        defaulted: { count: 0, total_amount: '0', total_installments_amount: '0' },
      },
      total_orders: 100,
      available_capital: '5000',
    });
    mockCountCerts.mockResolvedValue({ total: 0 });
    mockListMerchants.mockResolvedValue({ data: [], total: 0, limit: 200, offset: 0 });
    mockListOrders.mockResolvedValue({ data: [], total: 0, limit: 50, offset: 0 });
  });

  it('renders header, banner, filters and table', async () => {
    renderWithQuery(<StockPage />);
    expect(screen.getByRole('heading', { level: 1, name: /stock de [oó]rdenes/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('100')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Disponibles' })).toHaveAttribute(
      'data-active',
      'true',
    );
  });

  it('re-keys the orders query when status filter changes', async () => {
    renderWithQuery(<StockPage />);
    await waitFor(() => expect(mockListOrders).toHaveBeenCalledTimes(1));
    expect(mockListOrders.mock.calls[0][0].status).toBe('available');

    fireEvent.click(screen.getByRole('button', { name: 'Todas' }));
    await waitFor(() => expect(mockListOrders).toHaveBeenCalledTimes(2));
    expect(mockListOrders.mock.calls[1][0].status).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/stock/stock-page.test.tsx
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `<StockPage>`**

Create `/Users/llam/dev/araguaney_front/components/stock/stock-page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { StockStatsBanner } from './stock-stats-banner';
import { StockFilters, type StockFiltersValue } from './stock-filters';
import { StockTable } from './stock-table';

const INITIAL_FILTERS: StockFiltersValue = {
  status: 'available',
  merchantId: null,
  maxDueDateLte: null,
  q: '',
};

export function StockPage() {
  const [filters, setFiltersInternal] = useState<StockFiltersValue>(INITIAL_FILTERS);
  const [page, setPage] = useState(0);

  function setFilters(next: StockFiltersValue) {
    setFiltersInternal(next);
    setPage(0); // reset pagination when any filter changes
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] px-9 py-7">
      <PageHeader
        breadcrumb={{ section: 'Operación', current: 'Stock de órdenes' }}
        title="Stock de órdenes"
      />
      <div className="mt-6 flex flex-col gap-6">
        <StockStatsBanner />
        <StockFilters value={filters} onChange={setFilters} />
        <StockTable filters={filters} page={page} onPageChange={setPage} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Confirm tests pass**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/stock/stock-page.test.tsx
```

Expected: 2 tests green.

- [ ] **Step 5: Verify suite**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

Expected: all clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/stock/stock-page.tsx components/stock/stock-page.test.tsx
git commit -m "$(cat <<'EOF'
feat(stock): StockPage orchestrator

Owns filter + page state. Resets to page 0 whenever any filter
changes (otherwise the user can land on an out-of-bounds page).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Wire `app/(app)/stock/page.tsx`

**Why:** Replace the `<ComingSoon />` stub with the real `<StockPage>`. Server component shell, identical pattern to Slice 2's batches route.

**Files:**
- Modify: `app/(app)/stock/page.tsx`

- [ ] **Step 1: Replace the route file**

Overwrite `/Users/llam/dev/araguaney_front/app/(app)/stock/page.tsx`:

```tsx
import { StockPage } from '@/components/stock/stock-page';

export default function StockRoute() {
  return <StockPage />;
}
```

- [ ] **Step 2: Verify suite**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

Expected: all clean.

- [ ] **Step 3: Verify build**

```bash
cd /Users/llam/dev/araguaney_front
pnpm build
```

Expected: build succeeds. The output should show `/stock` as `ƒ` (dynamic) — the `(app)` layout already declares `dynamic = 'force-dynamic'` and `maxDuration = 300`, no per-route additions needed.

- [ ] **Step 4: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add "app/(app)/stock/page.tsx"
git commit -m "$(cat <<'EOF'
feat(stock): wire /stock route to StockPage

Replaces the Slice 1 ComingSoon stub. Server-component shell,
mirroring app/(app)/batches/page.tsx.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Local smoke + visual sanity

**Why:** Catch wiring issues against a local dev build before pushing. Confirm filters round-trip and table re-fetches.

**Files:** none (verification only).

**Pre-req:** `.env.local` already has `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` from Slice 0/1/2.

- [ ] **Step 1: Boot dev**

```bash
cd /Users/llam/dev/araguaney_front
lsof -ti:3000 | xargs kill -9 2>/dev/null
pnpm dev > /tmp/front-task13.log 2>&1 &
PID=$!
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if grep -q "Ready in" /tmp/front-task13.log 2>/dev/null; then echo "ready in ${i}s"; break; fi
  sleep 1
done
```

- [ ] **Step 2: Verify route gating**

```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3000/stock
# Expected: 307 → /login   (the (app) layout's auth gate)
```

- [ ] **Step 3: Visual flow in browser**

Login as `operator` → click "Stock de órdenes" in sidebar → land on `/stock`.

Verify:
- Sidebar `Stock de órdenes` is highlighted (yellow bar).
- Topbar: breadcrumb "Operación · **Stock de órdenes**", h1 "Stock de órdenes".
- Banner: 3 cards. "Capital disponible" with a real money value, "Órdenes disponibles" with a count, "Certs esta semana" with a number (likely 0 in test data).
- Filters row: "Disponibles" pill is active by default; "Todas / Asignadas / Vencidas" exist; comercio dropdown populated; date input visible; search input on the right.
- Table loads ≤ 50 rows with concrete data (codes, fechas, comercios, cuotas, montos, status pills).
- Click "Todas" → table refetches; banner stays the same.
- Type `8565` in search → after ~300ms the table refetches with filtered results (or "Ningún resultado" if there's no match in dev data).
- Pick a comercio in the dropdown → table refetches.
- Set "Vence antes de" to a date → table refetches.
- Click `→` in pagination → goes to page 2 (if total > 50). Banner does NOT refetch.

- [ ] **Step 4: Stop dev**

```bash
kill $PID; wait $PID 2>/dev/null
```

- [ ] **Step 5: No commit**

Verification only. If anything was broken, fix in a new commit on the same branch and re-verify.

---

## Task 14: Push branch + open PR

**Files:** none (git/GitHub).

- [ ] **Step 1: Push**

```bash
cd /Users/llam/dev/araguaney_front
git push -u origin feat/slice-3-stock
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "feat: Slice 3 — /stock (Stock de órdenes)" --body "$(cat <<'EOF'
## Summary

Stock de órdenes page: stat banner (Capital disponible · Órdenes disponibles · Certs emitidos esta semana) + 4 filters (status, comercio, max-due-date, search por código) + paginated orders table. Read-only — no detail view, no mutations. Conecta con `/api/orders`, `/api/orders/stats`, `/api/merchants`, `/api/certificates`.

## What's new

**Utilities:**
- `lib/format/week.ts` — `mondayOfThisWeekUTC`, `todayUTC` (used by the certs-this-week banner card)

**Types + API:**
- `lib/types/order.ts` — `OrderStatus`, `OrderSummary`, `OrdersListResponse`, `OrdersStats` (hand-typed; back openapi gap)
- `lib/types/merchant.ts` — `MerchantSummary`, `MerchantsListResponse`
- `lib/api/orders.ts` — `listOrders`, `getOrdersStats`
- `lib/api/merchants.ts` — `listMerchants`
- `lib/api/certificates.ts` — `countCertificatesIssued` (count-only)

**Components:**
- `components/ui/pill.tsx` — adds `danger` variant (rose) for the `defaulted` order status
- `components/stock/` — 6 components:
  - `OrderStatusPill` (Pill wrapper)
  - `OrderRow` (one `<tr>`)
  - `StockStatsBanner` (3 cards)
  - `StockFilters` (status pills + comercio + max-due-date + debounced search)
  - `StockTable` (useQuery + skeleton/error/empty + pagination footer)
  - `StockPage` (orchestrator)

**Wiring:**
- `app/(app)/stock/page.tsx` replaces the Slice 1 ComingSoon stub.

## Test Plan

- [x] `pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check && pnpm build` — all clean
- [x] Local smoke: route gating + filters round-trip + pagination
- [ ] Vercel preview deploy renders without console errors
- [ ] Real data smoke (against production back) — banner shows real numbers, table loads available orders

## Notes

- No detail view: clicking a row does nothing. Slice 3b if Tesorería pide troubleshooting.
- Filters by end_user / batch / fecha de compra / fecha de compra rango → out of scope (back accepts them, front doesn't expose).
- Search has 300ms debounce on the input.
- `merchants` endpoint capped at `limit=200`; if it grows past that we'll need cmdk-style autocomplete.
- Status pill has 4 tones (success/warn/neutral/danger) — `danger` was added to the Pill primitive in this slice.
- `(app)/layout.tsx` already declares `dynamic = 'force-dynamic'` + `maxDuration = 300` from Slice 2; no per-route additions needed.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

If `gh` fails with "must be a collaborator", open the PR manually at the URL printed by the push.

- [ ] **Step 3: Watch CI**

```bash
until gh run list --repo armandogois-lab/araguaney_front --limit 1 --json status -q '.[0].status' | grep -q completed; do sleep 5; done
gh run list --repo armandogois-lab/araguaney_front --limit 1
```

Expected: green ✓.

If CI fails, capture the log, fix locally, push to the same branch (PR auto-updates), watch again.

---

## Self-Review

**Spec coverage:**

- ✅ Goal: `/stock` page with banner + filters + table — Tasks 11, 12
- ✅ Three banner cards (capital · count · certs-this-week) — Tasks 5, 8
- ✅ Four filters (status / comercio / max-due-date / código search) — Task 9
- ✅ Status default "Disponibles" — Task 11 (`INITIAL_FILTERS`)
- ✅ Pagination 50/page with N–M de TOTAL footer — Task 10
- ✅ TanStack queries with the staleTime values from spec — Tasks 8, 9, 10
- ✅ Server Action pattern with `rethrowWithMessage` — Tasks 3, 4, 5
- ✅ Hand-typed shapes — Task 1
- ✅ OrderStatusPill mapping — Task 6
- ✅ `Pill` `danger` variant added — Task 6
- ✅ Empty / error / loading states for the table — Task 10
- ✅ Search debounce 300ms — Task 9
- ✅ `monday-of-this-week` helper — Task 2
- ✅ Layout uses existing `<PageHeader>` and container width — Task 11
- ✅ Reset page to 0 when filters change — Task 11 (`setFilters`)
- ✅ Smoke verification (route gate + visual) — Task 13
- ✅ PR opened — Task 14

**Placeholder scan:** No `TODO`/`TBD`/`fill in` markers. Sample test data uses concrete values pulled from real production records (Lote_00109 capital ≈ $927,913).

**Type consistency:**
- `OrderSummary`, `OrderStatus`, `OrdersListResponse`, `OrdersStats` defined in Task 1 used identically in Tasks 3, 7, 10 ✓
- `MerchantsListResponse` from Task 1 used in Task 4 (api) and Task 9 (filters) ✓
- `StockFiltersValue` defined in Task 9 used by Task 10 (table) and Task 11 (page) ✓
- `ListOrdersQuery` exported from `lib/api/orders.ts` (Task 3) consumed by `<StockTable>` (Task 10) ✓
- `PillVariant` extension to include `'danger'` (Task 6) consumed by `OrderStatusPill` (Task 6) — same task ✓
- `mondayOfThisWeekUTC()` / `todayUTC()` (Task 2) consumed by `<StockStatsBanner>` (Task 8) ✓
- `setFilters` resets page = 0 in `<StockPage>` (Task 11), and `<StockTable>` keys query by `[query]` derived from `filters + page` (Task 10) — consistent ✓
- TanStack v5 `placeholderData: (prev) => prev` used in Task 10 (correct API for v5 — `keepPreviousData` is removed) ✓

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-08-front-slice-3-stock.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, two-stage review (spec compliance + code quality) between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session with batch checkpoints.

**Which approach?**
