# araguaney_front Slice 5 — `/certificates` list + detail + cancel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/certificates` list page + `/certificates/{id}` detail page + Cancel-certificate modal. Closes the "crear → ver → cancelar" loop opened by Slice 4 (wizard) and Slice 3 (stock).

**Architecture:** Two routes: list at `/certificates` with filters/pagination, detail at `/certificates/[id]` with header + hero strip + orders table + audit sidebar. Cancel is a modal mounted from the detail header, calling `POST /api/certificates/:id/cancel`. Both pages are client components mounted from thin Server Component shells, identical to Slices 3/4.

**Tech Stack:** Next.js 16 App Router, TanStack Query v5, shadcn/ui base-nova primitives + extended `<Pill>`, sonner toasts, Vitest + Testing Library, hand-typed shapes.

**Spec:** `/Users/llam/dev/araguaney_back/docs/superpowers/specs/2026-05-10-front-slice-5-certificates-list-detail-design.md`

**Working directory note:** all front code lives in `/Users/llam/dev/araguaney_front/`. Plan and spec live in `/Users/llam/dev/araguaney_back/docs/`. Implementer must `cd /Users/llam/dev/araguaney_front` for any task command.

**Pre-req branch:** Work on `feat/slice-5-certificates` (Task 1 creates this from `main`).

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `lib/types/certificate.ts` | modify | Rename `Certificate.code` → `certificate_code`, `capital` → `investor_capital`, `rate` → `annual_rate`; drop `num_orders`/`issued_at` (unused); add `CertificateSummary`, `CertificateDetail`, `CertificateOrder`, `CertificateEvent`, `Cancellation` |
| `components/cert-wizard/step3-confirm.tsx` | modify | Toast `cert.code` → `cert.certificate_code` (bugfix) |
| `components/cert-wizard/step3-confirm.test.tsx` | modify | Update mock to return `certificate_code` |
| `lib/format/cycle-day.ts` | create | `daysSince(iso)` for hero strip status sub-label |
| `lib/format/cycle-day.test.ts` | create | Tests |
| `lib/api/certificates.ts` | modify | Add `listCertificates`, `getCertificateDetail`, `cancelCertificate`; update `issueCertificate` return type to `CertificateDetail` |
| `lib/api/certificates.test.ts` | modify | Tests for the 3 new functions |
| `lib/permissions/has-permission.ts` | modify | Add `certificate.cancel` (operator + admin) |
| `lib/permissions/has-permission.test.ts` | modify | Tests for new permission |
| `components/certificates/certificate-status-pill.tsx` | create | `Pill` wrapper mapping `CertificateStatus` → variant + Spanish label |
| `components/certificates/certificate-status-pill.test.tsx` | create | Tests per status |
| `components/certificates/certificate-row.tsx` | create | Single `<tr>` with router.push on click |
| `components/certificates/certificate-row.test.tsx` | create | Tests |
| `components/certificates/certificate-filters.tsx` | create | Status pills + investor select + date range + search |
| `components/certificates/certificate-filters.test.tsx` | create | Tests |
| `components/certificates/certificates-table.tsx` | create | `useQuery` + table + pagination |
| `components/certificates/certificates-table.test.tsx` | create | Tests |
| `components/certificates/certificates-page.tsx` | create | Orchestrator: header + filters + table |
| `components/certificates/certificates-page.test.tsx` | create | Smoke |
| `app/(app)/certificates/page.tsx` | modify | Replace ComingSoon with `<CertificatesPage />` |
| `components/certificates/cert-header.tsx` | create | Breadcrumb + title + status pill + Cancel button (permission-gated) |
| `components/certificates/cert-header.test.tsx` | create | Tests |
| `components/certificates/cert-hero-strip.tsx` | create | 5 stat cards |
| `components/certificates/cert-hero-strip.test.tsx` | create | Tests |
| `components/certificates/cert-orders-table.tsx` | create | Pool orders table with substring filter |
| `components/certificates/cert-orders-table.test.tsx` | create | Tests |
| `components/certificates/cert-audit-sidebar.tsx` | create | Investor info + rules ✓ + audit timeline |
| `components/certificates/cert-audit-sidebar.test.tsx` | create | Tests |
| `components/certificates/cancel-cert-modal.tsx` | create | Modal with textarea reason + mutation |
| `components/certificates/cancel-cert-modal.test.tsx` | create | Tests |
| `components/certificates/certificate-detail-page.tsx` | create | Orchestrator: header + hero + body grid + modal |
| `components/certificates/certificate-detail-page.test.tsx` | create | Smoke |
| `app/(app)/certificates/[id]/page.tsx` | create | Server shell mounting `<CertificateDetailPage id={...} />` |

**Total:** 22 new + 6 modified files. ~62 tests.

**Manual operational tasks:**

| Action | Owner | When |
|---|---|---|
| Push branch + open PR | controller | Task 19 |
| Review + merge | user | After Task 19 |
| Verify Vercel deploy + visual smoke | user | Post-merge |

---

## Task 1: Branch + Certificate type rename + wizard toast fix

**Why:** Slice 4 hand-typed `Certificate` with wrong field names; back actually returns `certificate_code` / `investor_capital` / `annual_rate`. The wizard's `step3-confirm.tsx` reads `cert.code` which is undefined in production. Fix the type, fix the toast, add the new types (`CertificateSummary`, `CertificateDetail`, etc.) that the list/detail consume.

**Files:**
- Modify: `lib/types/certificate.ts`
- Modify: `components/cert-wizard/step3-confirm.tsx`
- Modify: `components/cert-wizard/step3-confirm.test.tsx`

- [ ] **Step 1: Create branch from main**

```bash
cd /Users/llam/dev/araguaney_front
git fetch origin --prune
git checkout main
git pull origin main
git checkout -b feat/slice-5-certificates
```

- [ ] **Step 2: Rewrite `lib/types/certificate.ts`**

Replace the full contents of `/Users/llam/dev/araguaney_front/lib/types/certificate.ts` with:

```ts
export type CertificateStatus = 'draft' | 'issued' | 'matured' | 'cancelled';
export type CertificateType = 'standard' | 'sweep';
export type CertificateTermDays = 14 | 42;

export interface CertificateInvestorRef {
  id: string;
  legal_name: string;
  rif: string;
}

export interface CertificateIssuedBy {
  id: string;
  email: string;
  full_name: string;
}

/** Wire shape from GET /api/certificates list rows AND POST /api/certificates/:id/cancel. */
export interface CertificateSummary {
  id: string;
  certificate_code: string;
  certificate_type: CertificateType;
  status: CertificateStatus;
  investor: CertificateInvestorRef;
  investor_capital: string;
  annual_rate: string;
  term_days: CertificateTermDays;
  price: string;
  nominal_target: string;
  nominal_actual: string;
  investor_paid: string;
  investor_yield: string;
  shortfall_pct: string;
  issue_date: string;
  maturity_date: string;
  cycle_week: string;
  issued_by: CertificateIssuedBy;
  created_at: string;
}

export interface Cancellation {
  cancelled_at: string;
  cancelled_by: CertificateIssuedBy | null;
  reason: string | null;
}

export interface CertificateOrderInstallment {
  installment_number: number;
  amount: string;
  due_date: string;
  status: 'pending' | 'paid' | 'overdue' | 'cancelled';
}

export interface CertificateOrder {
  id: string;
  external_order_id: string;
  merchant: { id: string; current_name: string; rif: string };
  purchase_date: string;
  max_due_date: string;
  installments_sum_snapshot: string;
  assigned_at: string;
  installments: CertificateOrderInstallment[];
}

export interface CertificateEvent {
  id: string;
  event_type: string;
  occurred_at: string;
  payload: unknown;
  actor_id: string | null;
}

/** Wire shape from GET /api/certificates/:id AND POST /api/certificates (issue). */
export interface CertificateDetail extends CertificateSummary {
  investor_returned: string;
  payload_hash: string;
  cancellation: Cancellation | null;
  orders: CertificateOrder[];
  events: CertificateEvent[];
}

/** Back-compat alias — the wizard's issueCertificate returns this (the back returns full detail). */
export type Certificate = CertificateDetail;

export interface CertificatesListResponse {
  data: CertificateSummary[];
  total: number;
  limit: number;
  offset: number;
}

// === Below: types kept from Slice 4 (wizard simulation, untouched) ===

export interface SimConcentrationItem {
  merchant_id: string;
  current_name: string;
  rif: string;
  amount: string;
  pct: string;
}

export interface SimDueDateItem {
  date: string;
  amount: string;
}

export interface SimSelectedOrder {
  id: string;
  installments_sum: string;
  merchant_id: string;
  num_installments: number;
  max_due_date: string;
}

export interface SimulationResult {
  investor: CertificateInvestorRef;
  capital: string;
  rate: string;
  term_days: CertificateTermDays;
  issue_date: string;
  maturity_date: string;
  price: string;
  nominal_target: string;
  nominal_actual: string;
  investor_paid: string;
  investor_returned: string;
  investor_yield: string;
  shortfall_pct: string;
  selected_orders: SimSelectedOrder[];
  total_eligible_merchants: number;
  total_distinct_merchants: number;
  installment_plazo_days: { min: number; max: number };
  concentration_top: SimConcentrationItem[];
  due_date_distribution: SimDueDateItem[];
  payload_hash: string;
}
```

- [ ] **Step 3: Verify typecheck shows the wizard error**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck
```

Expected: error in `components/cert-wizard/step3-confirm.tsx` about `cert.code` not existing on `Certificate`. That's the type system catching the bug Slice 4 shipped.

- [ ] **Step 4: Fix the wizard toast**

Edit `/Users/llam/dev/araguaney_front/components/cert-wizard/step3-confirm.tsx`. Find the toast line (inside `mut`'s `onSuccess`):

```tsx
toast.success(`Certificado ${cert.code} emitido`);
```

Replace with:

```tsx
toast.success(`Certificado ${cert.certificate_code} emitido`);
```

- [ ] **Step 5: Update wizard step3 test**

Edit `/Users/llam/dev/araguaney_front/components/cert-wizard/step3-confirm.test.tsx`. Find:

```ts
mockIssue.mockResolvedValueOnce({ id: 'c-1', code: 'C0001A' });
```

Replace with:

```ts
mockIssue.mockResolvedValueOnce({ id: 'c-1', certificate_code: 'C0001A' });
```

The `expect.stringContaining('C0001A')` assertion further down already works since the substring is what's asserted, not the exact toast format.

- [ ] **Step 6: Verify suite + commit**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

Expected: all clean.

```bash
cd /Users/llam/dev/araguaney_front
git add lib/types/certificate.ts components/cert-wizard/step3-confirm.tsx components/cert-wizard/step3-confirm.test.tsx
git commit -m "$(cat <<'EOF'
feat(types): align Certificate types with back wire shape

Slice 4 hand-typed Certificate with fields named `code` / `capital` /
`rate` but the back actually returns `certificate_code` /
`investor_capital` / `annual_rate`. Step3Confirm's toast read
`cert.code` → "Certificado undefined emitido" in production.

Rename to match the back. Add CertificateSummary, CertificateDetail
(with embedded orders + events + cancellation), and supporting types
for the upcoming list/detail pages. Keep Certificate as a
back-compat alias for CertificateDetail (the wizard issue endpoint
returns full detail).

Fix the wizard toast as part of the rename.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `lib/format/cycle-day.ts`

**Why:** Hero strip status card shows "día N de 42" for active certs. Pure helper.

**Files:**
- Create: `lib/format/cycle-day.ts`
- Create: `lib/format/cycle-day.test.ts`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/lib/format/cycle-day.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { daysSince } from './cycle-day';

describe('daysSince', () => {
  it('returns 0 when the reference is today', () => {
    const today = new Date(Date.UTC(2026, 4, 10, 14, 30, 0));
    expect(daysSince('2026-05-10', today)).toBe(0);
  });

  it('returns N for N whole days elapsed', () => {
    const ref = new Date(Date.UTC(2026, 4, 12, 0, 0, 0));
    expect(daysSince('2026-05-10', ref)).toBe(2);
  });

  it('returns 0 when reference is before the date (clamped)', () => {
    const ref = new Date(Date.UTC(2026, 4, 5, 0, 0, 0));
    expect(daysSince('2026-05-10', ref)).toBe(0);
  });

  it('handles end of month boundary', () => {
    const ref = new Date(Date.UTC(2026, 5, 2, 0, 0, 0));   // 2026-06-02
    expect(daysSince('2026-05-30', ref)).toBe(3);
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/format/cycle-day.test.ts
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/lib/format/cycle-day.ts`:

```ts
/**
 * Whole-day difference between `from` (YYYY-MM-DD) and `at` (default: now), in UTC.
 * Negative results clamp to 0 — we never want "día -2" on a hero strip.
 */
export function daysSince(from: string, at: Date = new Date()): number {
  const [y, m, d] = from.split('-').map(Number);
  const fromMs = Date.UTC(y, m - 1, d);
  const atMs = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
  const diff = Math.floor((atMs - fromMs) / 86_400_000);
  return Math.max(0, diff);
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/format/cycle-day.test.ts
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

Expected: 4/4 + suite green.

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add lib/format/cycle-day.ts lib/format/cycle-day.test.ts
git commit -m "$(cat <<'EOF'
feat(format): daysSince helper

For the certificate detail hero strip status card: "día N de 42".
Pure UTC math; clamps to 0 for issue dates in the future (e.g., a
cert issued at end-of-day).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Extend `lib/api/certificates.ts`

**Why:** List/detail/cancel Server Actions.

**Files:**
- Modify: `lib/api/certificates.ts`
- Modify: `lib/api/certificates.test.ts`

- [ ] **Step 1: Failing tests (append to existing test file)**

Append to `/Users/llam/dev/araguaney_front/lib/api/certificates.test.ts`:

```ts
import { listCertificates, getCertificateDetail, cancelCertificate } from './certificates';

describe('listCertificates', () => {
  beforeEach(() => vi.clearAllMocks());

  it('GETs /api/certificates with no params', async () => {
    mockApiFetch.mockResolvedValueOnce({ data: [], total: 0, limit: 50, offset: 0 });
    await listCertificates({});
    expect(mockApiFetch).toHaveBeenCalledWith('/api/certificates', { method: 'GET' });
  });

  it('appends every supported filter', async () => {
    mockApiFetch.mockResolvedValueOnce({ data: [], total: 0, limit: 50, offset: 0 });
    await listCertificates({
      limit: 50,
      offset: 0,
      status: 'issued',
      investor_id: 'inv-1',
      issue_date_from: '2026-05-01',
      issue_date_to: '2026-05-31',
      q: 'C4572',
      sort: 'issue_date_desc',
    });
    const path = mockApiFetch.mock.calls[0][0] as string;
    expect(path).toContain('status=issued');
    expect(path).toContain('investor_id=inv-1');
    expect(path).toContain('issue_date_from=2026-05-01');
    expect(path).toContain('issue_date_to=2026-05-31');
    expect(path).toContain('q=C4572');
    expect(path).toContain('sort=issue_date_desc');
  });
});

describe('getCertificateDetail', () => {
  beforeEach(() => vi.clearAllMocks());

  it('GETs /api/certificates/{id}', async () => {
    mockApiFetch.mockResolvedValueOnce({ id: 'c-1', certificate_code: 'C0001A' });
    await getCertificateDetail('c-1');
    expect(mockApiFetch).toHaveBeenCalledWith('/api/certificates/c-1', { method: 'GET' });
  });
});

describe('cancelCertificate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POSTs reason as JSON body to /api/certificates/{id}/cancel', async () => {
    mockApiFetch.mockResolvedValueOnce({ id: 'c-1', certificate_code: 'C0001A', status: 'cancelled' });
    const result = await cancelCertificate('c-1', 'Cliente solicitó baja');
    expect(result.status).toBe('cancelled');
    const [path, init] = mockApiFetch.mock.calls[0];
    expect(path).toBe('/api/certificates/c-1/cancel');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ reason: 'Cliente solicitó baja' });
  });
});
```

- [ ] **Step 2: Confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/api/certificates.test.ts
```

Expected: 3 new tests fail (functions not exported).

- [ ] **Step 3: Implement**

Append to `/Users/llam/dev/araguaney_front/lib/api/certificates.ts` (do NOT touch existing functions):

```ts
import type {
  CertificateDetail,
  CertificateStatus,
  CertificatesListResponse,
} from '@/lib/types/certificate';

export interface ListCertificatesQuery {
  limit?: number;
  offset?: number;
  status?: CertificateStatus;
  investor_id?: string;
  issue_date_from?: string;
  issue_date_to?: string;
  q?: string;
  sort?: 'issue_date_desc' | 'issue_date_asc' | 'code_asc';
}

export async function listCertificates(
  query: ListCertificatesQuery,
): Promise<CertificatesListResponse> {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.offset !== undefined) params.set('offset', String(query.offset));
  if (query.status) params.set('status', query.status);
  if (query.investor_id) params.set('investor_id', query.investor_id);
  if (query.issue_date_from) params.set('issue_date_from', query.issue_date_from);
  if (query.issue_date_to) params.set('issue_date_to', query.issue_date_to);
  if (query.q) params.set('q', query.q);
  if (query.sort) params.set('sort', query.sort);
  const qs = params.toString();
  try {
    return await apiFetch<CertificatesListResponse>(
      `/api/certificates${qs ? '?' + qs : ''}`,
      { method: 'GET' },
    );
  } catch (err) {
    rethrowWithMessage(err);
  }
}

export async function getCertificateDetail(id: string): Promise<CertificateDetail> {
  try {
    return await apiFetch<CertificateDetail>(`/api/certificates/${id}`, { method: 'GET' });
  } catch (err) {
    rethrowWithMessage(err);
  }
}

export async function cancelCertificate(
  id: string,
  reason: string,
): Promise<CertificateDetail> {
  try {
    return await apiFetch<CertificateDetail>(`/api/certificates/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  } catch (err) {
    rethrowWithMessage(err);
  }
}
```

Also: update the existing `issueCertificate` return type from `Certificate` to `CertificateDetail` (they're aliased, but explicit is clearer). Find this line in the same file:

```ts
export async function issueCertificate(body: IssueCertificateBody): Promise<Certificate> {
```

Replace with:

```ts
export async function issueCertificate(body: IssueCertificateBody): Promise<CertificateDetail> {
```

And update the import at the top of the file if `Certificate` is not used elsewhere:

```ts
import type { Certificate, CertificateTermDays, SimulationResult } from '@/lib/types/certificate';
```

If `Certificate` is no longer referenced after the change, drop it; otherwise leave it. (Verify with `pnpm typecheck`.)

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/api/certificates.test.ts
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add lib/api/certificates.ts lib/api/certificates.test.ts
git commit -m "$(cat <<'EOF'
feat(api): listCertificates + getCertificateDetail + cancelCertificate

Three new Server Actions for the Slice 5 list/detail/cancel feature.
Same rethrowWithMessage pattern as the rest of the api/ functions.
Update issueCertificate return type to CertificateDetail to match
what the back actually returns (full detail, not just the summary).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Add `certificate.cancel` permission

**Files:**
- Modify: `lib/permissions/has-permission.ts`
- Modify: `lib/permissions/has-permission.test.ts`

- [ ] **Step 1: Inspect existing**

```bash
cd /Users/llam/dev/araguaney_front
cat lib/permissions/has-permission.ts
cat lib/permissions/has-permission.test.ts
```

Look for where roles map to permission lists. `certificate.simulate` (Slice 4) should already be there — `certificate.cancel` follows the same pattern.

- [ ] **Step 2: Failing test**

Append to `/Users/llam/dev/araguaney_front/lib/permissions/has-permission.test.ts`:

```ts
describe('certificate.cancel', () => {
  it('operator has it', () => {
    expect(hasPermission('operator', 'certificate.cancel')).toBe(true);
  });
  it('admin has it', () => {
    expect(hasPermission('admin', 'certificate.cancel')).toBe(true);
  });
  it('auditor does NOT have it', () => {
    expect(hasPermission('auditor', 'certificate.cancel')).toBe(false);
  });
});
```

- [ ] **Step 3: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/permissions/has-permission.test.ts
```

Expected: 3 new tests fail.

- [ ] **Step 4: Implement**

Edit `/Users/llam/dev/araguaney_front/lib/permissions/has-permission.ts`. Find the operator permissions array/set (likely named `OPERATOR_PERMS` or similar). Add `'certificate.cancel'` to it.

The Permission type union likely needs updating too — add `'certificate.cancel'` to the union. Use `pnpm typecheck` to confirm the type is wired.

- [ ] **Step 5: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/permissions/has-permission.test.ts
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 6: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add lib/permissions/has-permission.ts lib/permissions/has-permission.test.ts
git commit -m "$(cat <<'EOF'
feat(permissions): add certificate.cancel

operator + admin allowed, auditor blocked. Mirrors the back's
RequirePermission gating on POST /api/certificates/:id/cancel.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `<CertificateStatusPill>`

**Files:**
- Create: `components/certificates/certificate-status-pill.tsx`
- Create: `components/certificates/certificate-status-pill.test.tsx`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/components/certificates/certificate-status-pill.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CertificateStatusPill } from './certificate-status-pill';

describe('<CertificateStatusPill />', () => {
  it('shows "Borrador" with neutral tone for draft', () => {
    const { container } = render(<CertificateStatusPill status="draft" />);
    expect(screen.getByText('Borrador')).toBeInTheDocument();
    expect(container.querySelector('span')?.className).toContain('bg-neutral-bg');
  });

  it('shows "Activo" with success tone for issued', () => {
    const { container } = render(<CertificateStatusPill status="issued" />);
    expect(screen.getByText('Activo')).toBeInTheDocument();
    expect(container.querySelector('span')?.className).toContain('bg-green-bg');
  });

  it('shows "Vencido" with info tone for matured', () => {
    const { container } = render(<CertificateStatusPill status="matured" />);
    expect(screen.getByText('Vencido')).toBeInTheDocument();
    expect(container.querySelector('span')?.className).toContain('bg-info-bg');
  });

  it('shows "Cancelado" with danger tone for cancelled', () => {
    const { container } = render(<CertificateStatusPill status="cancelled" />);
    expect(screen.getByText('Cancelado')).toBeInTheDocument();
    expect(container.querySelector('span')?.className).toContain('bg-rose-100');
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
mkdir -p components/certificates
pnpm test components/certificates/certificate-status-pill.test.tsx
```

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/certificates/certificate-status-pill.tsx`:

```tsx
import { Pill, type PillVariant } from '@/components/ui/pill';
import type { CertificateStatus } from '@/lib/types/certificate';

const MAP: Record<CertificateStatus, { variant: PillVariant; label: string }> = {
  draft: { variant: 'neutral', label: 'Borrador' },
  issued: { variant: 'success', label: 'Activo' },
  matured: { variant: 'info', label: 'Vencido' },
  cancelled: { variant: 'danger', label: 'Cancelado' },
};

export function CertificateStatusPill({ status }: { status: CertificateStatus }) {
  const m = MAP[status];
  return <Pill variant={m.variant}>{m.label}</Pill>;
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/certificates/certificate-status-pill.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/certificates/certificate-status-pill.tsx components/certificates/certificate-status-pill.test.tsx
git commit -m "$(cat <<'EOF'
feat(certificates): CertificateStatusPill

Status → variant + Spanish label. Uses the existing Pill primitive
including the 'danger' variant added in Slice 3.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `<CertificateRow>`

**Files:**
- Create: `components/certificates/certificate-row.tsx`
- Create: `components/certificates/certificate-row.test.tsx`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/components/certificates/certificate-row.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CertificateRow } from './certificate-row';
import type { CertificateSummary } from '@/lib/types/certificate';

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

function mockCert(over: Partial<CertificateSummary> = {}): CertificateSummary {
  return {
    id: 'c-1',
    certificate_code: 'C4572A',
    certificate_type: 'standard',
    status: 'issued',
    investor: { id: 'inv-1', legal_name: 'Inversora Alpha, C.A.', rif: 'J-12345678-9' },
    investor_capital: '100000.0000',
    annual_rate: '0.130000',
    term_days: 42,
    price: '0.984833',
    nominal_target: '101540.6000',
    nominal_actual: '101540.0000',
    investor_paid: '99999.4100',
    investor_yield: '1540.5900',
    shortfall_pct: '0.000006',
    issue_date: '2026-04-27',
    maturity_date: '2026-06-08',
    cycle_week: '2026-W18',
    issued_by: { id: 'u-1', email: 'op@x.com', full_name: 'María Rodríguez' },
    created_at: '2026-04-27T14:30:00Z',
    ...over,
  };
}

describe('<CertificateRow />', () => {
  function wrap(row: React.ReactElement) {
    return render(<table><tbody>{row}</tbody></table>);
  }

  it('renders all columns with formatted values', () => {
    wrap(<CertificateRow cert={mockCert()} />);
    expect(screen.getByText('C4572A')).toBeInTheDocument();
    expect(screen.getByText('Inversora Alpha, C.A.')).toBeInTheDocument();
    expect(screen.getByText('27/04/2026')).toBeInTheDocument();
    expect(screen.getByText('08/06/2026')).toBeInTheDocument();
    expect(screen.getByText('$100,000.00')).toBeInTheDocument();
    expect(screen.getByText('Activo')).toBeInTheDocument();
  });

  it('navigates to /certificates/{id} on click', () => {
    mockPush.mockClear();
    wrap(<CertificateRow cert={mockCert()} />);
    fireEvent.click(screen.getByText('C4572A'));
    expect(mockPush).toHaveBeenCalledWith('/certificates/c-1');
  });

  it('renders cancelled status correctly', () => {
    wrap(<CertificateRow cert={mockCert({ status: 'cancelled' })} />);
    expect(screen.getByText('Cancelado')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/certificates/certificate-row.test.tsx
```

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/certificates/certificate-row.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { fmtDate } from '@/lib/format/date';
import { fmtMoney2 } from '@/lib/format/money';
import type { CertificateSummary } from '@/lib/types/certificate';
import { CertificateStatusPill } from './certificate-status-pill';

export function CertificateRow({ cert }: { cert: CertificateSummary }) {
  const router = useRouter();
  return (
    <tr
      onClick={() => router.push(`/certificates/${cert.id}`)}
      className="border-border-soft hover:bg-subtle cursor-pointer border-b transition-colors"
    >
      <td className="text-text-2 px-4 py-3.5 font-mono text-[11.5px]">{cert.certificate_code}</td>
      <td className="max-w-[280px] truncate px-4 py-3.5" title={cert.investor.legal_name}>
        {cert.investor.legal_name}
      </td>
      <td className="num px-4 py-3.5">{fmtDate(cert.issue_date)}</td>
      <td className="num px-4 py-3.5">{fmtDate(cert.maturity_date)}</td>
      <td className="num px-4 py-3.5 text-right font-medium">
        {fmtMoney2(Number(cert.investor_capital))}
      </td>
      <td className="px-4 py-3.5">
        <CertificateStatusPill status={cert.status} />
      </td>
    </tr>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/certificates/certificate-row.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/certificates/certificate-row.tsx components/certificates/certificate-row.test.tsx
git commit -m "$(cat <<'EOF'
feat(certificates): CertificateRow

One row in the /certificates table: code, investor, issue/vence
dates, capital, status pill. Whole row is clickable → router.push.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `<CertificateFilters>`

**Files:**
- Create: `components/certificates/certificate-filters.tsx`
- Create: `components/certificates/certificate-filters.test.tsx`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/components/certificates/certificate-filters.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/test/helpers/tanstack';
import {
  CertificateFilters,
  type CertificateFiltersValue,
} from './certificate-filters';

const { mockListInvestors } = vi.hoisted(() => ({ mockListInvestors: vi.fn() }));

vi.mock('@/lib/api/investors', () => ({
  listInvestors: (...a: unknown[]) => mockListInvestors(...a),
}));

const DEFAULT: CertificateFiltersValue = {
  status: 'issued',
  investorId: null,
  issueDateFrom: null,
  issueDateTo: null,
  q: '',
};

describe('<CertificateFilters />', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListInvestors.mockResolvedValue({
      data: [
        {
          id: 'inv-1',
          legal_name: 'Alpha',
          rif: 'J-1',
          kind: 'juridica',
          status: 'active',
          email: null,
          phone: null,
        },
      ],
      total: 1,
      limit: 200,
      offset: 0,
    });
  });

  it('renders 4 status pills with Activos active by default', () => {
    renderWithQuery(<CertificateFilters value={DEFAULT} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Activos' })).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('button', { name: 'Todos' })).toHaveAttribute('data-active', 'false');
  });

  it('clicking "Todos" emits status: "all"', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithQuery(<CertificateFilters value={DEFAULT} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Todos' }));
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT, status: 'all' });
  });

  it('selecting an investor emits investorId', async () => {
    const onChange = vi.fn();
    renderWithQuery(<CertificateFilters value={DEFAULT} onChange={onChange} />);
    await waitFor(() => expect(mockListInvestors).toHaveBeenCalled());
    const select = await screen.findByLabelText(/inversor/i);
    fireEvent.change(select, { target: { value: 'inv-1' } });
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT, investorId: 'inv-1' });
  });

  it('emits issueDateFrom + issueDateTo when date inputs change', () => {
    const onChange = vi.fn();
    renderWithQuery(<CertificateFilters value={DEFAULT} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/emitido desde/i), {
      target: { value: '2026-05-01' },
    });
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT, issueDateFrom: '2026-05-01' });
    fireEvent.change(screen.getByLabelText(/hasta/i), { target: { value: '2026-05-31' } });
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT, issueDateTo: '2026-05-31' });
  });

  it('debounces the code search input by 300ms', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    renderWithQuery(<CertificateFilters value={DEFAULT} onChange={onChange} />);
    const input = screen.getByPlaceholderText(/c[oó]digo/i);
    fireEvent.change(input, { target: { value: 'C4572' } });
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(310);
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT, q: 'C4572' });
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/certificates/certificate-filters.test.tsx
```

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/certificates/certificate-filters.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listInvestors } from '@/lib/api/investors';
import type { CertificateStatus } from '@/lib/types/certificate';

export type CertificateStatusFilter = CertificateStatus | 'all';

export interface CertificateFiltersValue {
  status: CertificateStatusFilter;
  investorId: string | null;
  issueDateFrom: string | null;
  issueDateTo: string | null;
  q: string;
}

interface Props {
  value: CertificateFiltersValue;
  onChange: (next: CertificateFiltersValue) => void;
}

const STATUS_OPTIONS: Array<{ value: CertificateStatusFilter; label: string }> = [
  { value: 'issued', label: 'Activos' },
  { value: 'all', label: 'Todos' },
  { value: 'matured', label: 'Vencidos' },
  { value: 'cancelled', label: 'Cancelados' },
];

export function CertificateFilters({ value, onChange }: Props) {
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

  const investors = useQuery({
    queryKey: ['investors'],
    queryFn: () =>
      listInvestors({ limit: 200, kind: 'juridica', status: 'active', sort: 'name_asc' }),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  return (
    <div className="flex flex-col gap-3">
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
                  (active ? 'bg-foreground text-background' : 'text-text-2 hover:bg-subtle')
                }
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <input
          type="search"
          placeholder="🔎 Código (ej. C4572A)"
          value={qLocal}
          onChange={(e) => setQLocal(e.target.value)}
          className="border-border-subtle bg-card w-64 rounded-md border px-3 py-1.5 text-[12px]"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[11px]">
          <span className="text-text-3">Inversor</span>
          <select
            aria-label="Inversor"
            value={value.investorId ?? ''}
            onChange={(e) =>
              onChange({
                ...value,
                investorId: e.target.value === '' ? null : e.target.value,
              })
            }
            className="border-border-subtle bg-card rounded-md border px-2 py-1 text-[12px]"
            disabled={investors.isLoading}
          >
            <option value="">Todos</option>
            {investors.data?.data.map((inv) => (
              <option key={inv.id} value={inv.id}>
                {inv.legal_name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-[11px]">
          <span className="text-text-3">Emitido desde</span>
          <input
            type="date"
            aria-label="Emitido desde"
            value={value.issueDateFrom ?? ''}
            onChange={(e) =>
              onChange({
                ...value,
                issueDateFrom: e.target.value === '' ? null : e.target.value,
              })
            }
            className="border-border-subtle bg-card rounded-md border px-2 py-1 text-[12px]"
          />
        </label>
        <label className="flex items-center gap-2 text-[11px]">
          <span className="text-text-3">hasta</span>
          <input
            type="date"
            aria-label="hasta"
            value={value.issueDateTo ?? ''}
            onChange={(e) =>
              onChange({
                ...value,
                issueDateTo: e.target.value === '' ? null : e.target.value,
              })
            }
            className="border-border-subtle bg-card rounded-md border px-2 py-1 text-[12px]"
          />
        </label>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/certificates/certificate-filters.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/certificates/certificate-filters.tsx components/certificates/certificate-filters.test.tsx
git commit -m "$(cat <<'EOF'
feat(certificates): CertificateFilters

Status pills (Activos default) + investor dropdown + date range
inputs + debounced code search. Stateless except for the search
debounce, identical pattern to StockFilters.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `<CertificatesTable>`

**Files:**
- Create: `components/certificates/certificates-table.tsx`
- Create: `components/certificates/certificates-table.test.tsx`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/components/certificates/certificates-table.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithQuery } from '@/test/helpers/tanstack';
import { CertificatesTable } from './certificates-table';
import type { CertificateFiltersValue } from './certificate-filters';
import type { CertificateSummary } from '@/lib/types/certificate';

const { mockListCerts } = vi.hoisted(() => ({ mockListCerts: vi.fn() }));

vi.mock('@/lib/api/certificates', () => ({
  listCertificates: (...a: unknown[]) => mockListCerts(...a),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

function cert(over: Partial<CertificateSummary> = {}): CertificateSummary {
  return {
    id: 'c-' + Math.random(),
    certificate_code: 'C4572A',
    certificate_type: 'standard',
    status: 'issued',
    investor: { id: 'inv-1', legal_name: 'Alpha', rif: 'J-1' },
    investor_capital: '100000.0000',
    annual_rate: '0.130000',
    term_days: 42,
    price: '0.984833',
    nominal_target: '101540.6000',
    nominal_actual: '101540.0000',
    investor_paid: '99999.4100',
    investor_yield: '1540.5900',
    shortfall_pct: '0.000006',
    issue_date: '2026-04-27',
    maturity_date: '2026-06-08',
    cycle_week: '2026-W18',
    issued_by: { id: 'u-1', email: 'op@x.com', full_name: 'María R.' },
    created_at: '2026-04-27T14:30:00Z',
    ...over,
  };
}

const FILTERS: CertificateFiltersValue = {
  status: 'issued',
  investorId: null,
  issueDateFrom: null,
  issueDateTo: null,
  q: '',
};

describe('<CertificatesTable />', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows skeleton while fetching', () => {
    mockListCerts.mockImplementation(() => new Promise(() => {}));
    renderWithQuery(<CertificatesTable filters={FILTERS} page={0} onPageChange={() => {}} />);
    expect(screen.getByText(/cargando/i)).toBeInTheDocument();
  });

  it('shows empty state when no results', async () => {
    mockListCerts.mockResolvedValueOnce({ data: [], total: 0, limit: 50, offset: 0 });
    renderWithQuery(<CertificatesTable filters={FILTERS} page={0} onPageChange={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText(/ning[uú]n certificado/i)).toBeInTheDocument(),
    );
  });

  it('shows error state on failure', async () => {
    mockListCerts.mockRejectedValueOnce(new Error('boom'));
    renderWithQuery(<CertificatesTable filters={FILTERS} page={0} onPageChange={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText(/no se pudieron cargar/i)).toBeInTheDocument(),
    );
  });

  it('renders rows + pagination footer', async () => {
    mockListCerts.mockResolvedValueOnce({
      data: [cert({ certificate_code: 'A' }), cert({ certificate_code: 'B' })],
      total: 100,
      limit: 50,
      offset: 0,
    });
    renderWithQuery(<CertificatesTable filters={FILTERS} page={0} onPageChange={() => {}} />);
    await waitFor(() => expect(screen.getByText('A')).toBeInTheDocument());
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText(/1[–\-]50 de 100/)).toBeInTheDocument();
  });

  it('translates status="all" to undefined in the listCertificates call', async () => {
    mockListCerts.mockResolvedValueOnce({ data: [], total: 0, limit: 50, offset: 0 });
    renderWithQuery(
      <CertificatesTable
        filters={{ ...FILTERS, status: 'all' }}
        page={0}
        onPageChange={() => {}}
      />,
    );
    await waitFor(() => expect(mockListCerts).toHaveBeenCalled());
    expect(mockListCerts.mock.calls[0][0].status).toBeUndefined();
  });

  it('triggers onPageChange when next-page is clicked', async () => {
    mockListCerts.mockResolvedValueOnce({
      data: [cert()],
      total: 200,
      limit: 50,
      offset: 0,
    });
    const onPageChange = vi.fn();
    renderWithQuery(<CertificatesTable filters={FILTERS} page={0} onPageChange={onPageChange} />);
    await waitFor(() => expect(screen.getByLabelText(/p[aá]gina siguiente/i)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/p[aá]gina siguiente/i));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/certificates/certificates-table.test.tsx
```

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/certificates/certificates-table.tsx`:

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { listCertificates, type ListCertificatesQuery } from '@/lib/api/certificates';
import { CertificateRow } from './certificate-row';
import type { CertificateFiltersValue } from './certificate-filters';

const PAGE_LIMIT = 50;

interface Props {
  filters: CertificateFiltersValue;
  page: number;
  onPageChange: (next: number) => void;
}

function buildQuery(filters: CertificateFiltersValue, page: number): ListCertificatesQuery {
  return {
    limit: PAGE_LIMIT,
    offset: page * PAGE_LIMIT,
    status: filters.status === 'all' ? undefined : filters.status,
    investor_id: filters.investorId ?? undefined,
    issue_date_from: filters.issueDateFrom ?? undefined,
    issue_date_to: filters.issueDateTo ?? undefined,
    q: filters.q || undefined,
    sort: 'issue_date_desc',
  };
}

export function CertificatesTable({ filters, page, onPageChange }: Props) {
  const query = buildQuery(filters, page);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['certificates', query],
    queryFn: () => listCertificates(query),
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
            <Th>Inversor</Th>
            <Th>Emitido</Th>
            <Th>Vence</Th>
            <Th align="right">Capital</Th>
            <Th>Estado</Th>
          </tr>
        </thead>
        <tbody>
          {data.data.map((c) => (
            <CertificateRow key={c.id} cert={c} />
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
      <div className="text-text-3 text-sm">Cargando certificados…</div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="border-border-subtle bg-card flex h-64 flex-col items-center justify-center gap-3 rounded-xl border">
      <div className="text-text-3 text-sm">No se pudieron cargar los certificados.</div>
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
        Ningún certificado coincide con los filtros.
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/certificates/certificates-table.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/certificates/certificates-table.tsx components/certificates/certificates-table.test.tsx
git commit -m "$(cat <<'EOF'
feat(certificates): CertificatesTable with pagination

useQuery(['certificates', query]) with loading/empty/error states
and 50-per-page footer. status='all' translates to no status param.
Same pattern as StockTable.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `<CertificatesPage>` orchestrator

**Files:**
- Create: `components/certificates/certificates-page.tsx`
- Create: `components/certificates/certificates-page.test.tsx`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/components/certificates/certificates-page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithQuery } from '@/test/helpers/tanstack';
import { CertificatesPage } from './certificates-page';

const { mockListCerts, mockListInvestors } = vi.hoisted(() => ({
  mockListCerts: vi.fn(),
  mockListInvestors: vi.fn(),
}));

vi.mock('@/lib/api/certificates', () => ({
  listCertificates: (...a: unknown[]) => mockListCerts(...a),
}));

vi.mock('@/lib/api/investors', () => ({
  listInvestors: (...a: unknown[]) => mockListInvestors(...a),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe('<CertificatesPage />', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListCerts.mockResolvedValue({ data: [], total: 0, limit: 50, offset: 0 });
    mockListInvestors.mockResolvedValue({ data: [], total: 0, limit: 200, offset: 0 });
  });

  it('renders header + filters + table', async () => {
    renderWithQuery(<CertificatesPage />);
    expect(
      screen.getByRole('heading', { level: 1, name: /certificados/i }),
    ).toBeInTheDocument();
    await waitFor(() => expect(mockListCerts).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Activos' })).toHaveAttribute(
      'data-active',
      'true',
    );
  });

  it('re-keys the certificates query when status filter changes', async () => {
    renderWithQuery(<CertificatesPage />);
    await waitFor(() => expect(mockListCerts).toHaveBeenCalledTimes(1));
    expect(mockListCerts.mock.calls[0][0].status).toBe('issued');

    fireEvent.click(screen.getByRole('button', { name: 'Todos' }));
    await waitFor(() => expect(mockListCerts).toHaveBeenCalledTimes(2));
    expect(mockListCerts.mock.calls[1][0].status).toBeUndefined();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/certificates/certificates-page.test.tsx
```

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/certificates/certificates-page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import {
  CertificateFilters,
  type CertificateFiltersValue,
} from './certificate-filters';
import { CertificatesTable } from './certificates-table';

const INITIAL_FILTERS: CertificateFiltersValue = {
  status: 'issued',
  investorId: null,
  issueDateFrom: null,
  issueDateTo: null,
  q: '',
};

export function CertificatesPage() {
  const [filters, setFiltersInternal] = useState<CertificateFiltersValue>(INITIAL_FILTERS);
  const [page, setPage] = useState(0);

  function setFilters(next: CertificateFiltersValue) {
    setFiltersInternal(next);
    setPage(0);
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] px-9 py-7">
      <PageHeader
        breadcrumb={{ section: 'Operación', current: 'Certificados' }}
        title="Certificados"
      />
      <div className="mt-6 flex flex-col gap-6">
        <CertificateFilters value={filters} onChange={setFilters} />
        <CertificatesTable filters={filters} page={page} onPageChange={setPage} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/certificates/certificates-page.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/certificates/certificates-page.tsx components/certificates/certificates-page.test.tsx
git commit -m "$(cat <<'EOF'
feat(certificates): CertificatesPage orchestrator

Owns filter + page state. Resets page=0 on filter change.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Wire `app/(app)/certificates/page.tsx`

**Files:**
- Modify: `app/(app)/certificates/page.tsx`

- [ ] **Step 1: Replace route file**

Overwrite `/Users/llam/dev/araguaney_front/app/(app)/certificates/page.tsx`:

```tsx
import { CertificatesPage } from '@/components/certificates/certificates-page';

export default function CertificatesRoute() {
  return <CertificatesPage />;
}
```

- [ ] **Step 2: Verify + build**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
pnpm build
```

Expected: build succeeds, `/certificates` listed as `ƒ`.

- [ ] **Step 3: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add "app/(app)/certificates/page.tsx"
git commit -m "$(cat <<'EOF'
feat(certificates): wire /certificates list route

Replaces the Slice 1 ComingSoon stub. Server Component shell mounts
the client orchestrator.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: `<CertHeader>`

**Files:**
- Create: `components/certificates/cert-header.tsx`
- Create: `components/certificates/cert-header.test.tsx`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/components/certificates/cert-header.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CertHeader } from './cert-header';
import { UserProvider } from '@/lib/auth/user-context';
import type { CertificateDetail } from '@/lib/types/certificate';

function mockCert(over: Partial<CertificateDetail> = {}): CertificateDetail {
  return {
    id: 'c-1',
    certificate_code: 'C4572A',
    certificate_type: 'standard',
    status: 'issued',
    investor: { id: 'inv-1', legal_name: 'Inversora Alpha, C.A.', rif: 'J-12345678-9' },
    investor_capital: '100000.0000',
    annual_rate: '0.130000',
    term_days: 42,
    price: '0.984833',
    nominal_target: '101540.6000',
    nominal_actual: '101540.0000',
    investor_paid: '99999.4100',
    investor_returned: '0.5900',
    investor_yield: '1540.5900',
    shortfall_pct: '0.000006',
    issue_date: '2026-04-27',
    maturity_date: '2026-06-08',
    cycle_week: '2026-W18',
    issued_by: { id: 'u-1', email: 'op@x.com', full_name: 'María Rodríguez' },
    created_at: '2026-04-27T14:30:00Z',
    payload_hash: 'h',
    cancellation: null,
    orders: [],
    events: [],
    ...over,
  };
}

const operator = {
  id: 'u-1',
  email: 'op@x.com',
  full_name: 'Op',
  role: 'operator' as const,
  is_active: true,
};
const auditor = { ...operator, role: 'auditor' as const };

describe('<CertHeader />', () => {
  it('renders breadcrumb + title + code + status pill', () => {
    render(
      <UserProvider user={operator}>
        <CertHeader cert={mockCert()} onCancel={vi.fn()} />
      </UserProvider>,
    );
    expect(screen.getByText('Operación')).toBeInTheDocument();
    expect(screen.getByText('Certificados')).toBeInTheDocument();
    expect(screen.getByText('C4572A', { selector: 'b' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: /inversora alpha/i })).toBeInTheDocument();
    expect(screen.getByText('Activo')).toBeInTheDocument();
  });

  it('shows Cancelar button for operator when status=issued', () => {
    render(
      <UserProvider user={operator}>
        <CertHeader cert={mockCert()} onCancel={vi.fn()} />
      </UserProvider>,
    );
    expect(screen.getByRole('button', { name: /cancelar certificado/i })).toBeInTheDocument();
  });

  it('hides Cancelar button for auditor', () => {
    render(
      <UserProvider user={auditor}>
        <CertHeader cert={mockCert()} onCancel={vi.fn()} />
      </UserProvider>,
    );
    expect(screen.queryByRole('button', { name: /cancelar certificado/i })).not.toBeInTheDocument();
  });

  it('hides Cancelar button when status is not issued', () => {
    render(
      <UserProvider user={operator}>
        <CertHeader cert={mockCert({ status: 'cancelled' })} onCancel={vi.fn()} />
      </UserProvider>,
    );
    expect(screen.queryByRole('button', { name: /cancelar certificado/i })).not.toBeInTheDocument();
  });

  it('clicking Cancelar fires onCancel', () => {
    const onCancel = vi.fn();
    render(
      <UserProvider user={operator}>
        <CertHeader cert={mockCert()} onCancel={onCancel} />
      </UserProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /cancelar certificado/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/certificates/cert-header.test.tsx
```

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/certificates/cert-header.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { fmtDate } from '@/lib/format/date';
import { hasPermission } from '@/lib/permissions/has-permission';
import { useUser } from '@/lib/auth/user-context';
import type { CertificateDetail } from '@/lib/types/certificate';
import { CertificateStatusPill } from './certificate-status-pill';

interface Props {
  cert: CertificateDetail;
  onCancel: () => void;
}

export function CertHeader({ cert, onCancel }: Props) {
  const user = useUser();
  const canCancel =
    hasPermission(user.role, 'certificate.cancel') && cert.status === 'issued';

  return (
    <div>
      <div className="text-text-3 mb-2 text-[12px]">
        <Link href="/" className="hover:underline">
          Operación
        </Link>{' '}
        ·{' '}
        <Link href="/certificates" className="hover:underline">
          Certificados
        </Link>{' '}
        · <b className="text-text-2 font-mono font-medium">{cert.certificate_code}</b>
      </div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-3">
            <h1 className="text-[22px] font-semibold tracking-[-0.3px]">
              {cert.investor.legal_name}
            </h1>
            <span className="bg-subtle text-text-2 rounded-md px-2 py-0.5 font-mono text-[12px]">
              {cert.certificate_code}
            </span>
            <CertificateStatusPill status={cert.status} />
          </div>
          <div className="text-text-3 text-[12px]">
            Emitido {fmtDate(cert.issue_date)} por {cert.issued_by.full_name} ·{' '}
            <span className="font-mono">{cert.investor.rif}</span>
          </div>
        </div>
        {canCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="border-border-subtle bg-card text-text-2 hover:bg-subtle rounded-md border px-4 py-2 text-[12px] font-medium"
          >
            Cancelar certificado
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/certificates/cert-header.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/certificates/cert-header.tsx components/certificates/cert-header.test.tsx
git commit -m "$(cat <<'EOF'
feat(certificates): CertHeader

Breadcrumb + title (investor legal_name) + code pill + status pill +
subtitle (issued date/user/rif). Cancelar button visible only for
operator/admin on an issued cert.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: `<CertHeroStrip>`

**Files:**
- Create: `components/certificates/cert-hero-strip.tsx`
- Create: `components/certificates/cert-hero-strip.test.tsx`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/components/certificates/cert-hero-strip.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CertHeroStrip } from './cert-hero-strip';
import type { CertificateDetail } from '@/lib/types/certificate';

function mockCert(over: Partial<CertificateDetail> = {}): CertificateDetail {
  return {
    id: 'c-1',
    certificate_code: 'C4572A',
    certificate_type: 'standard',
    status: 'issued',
    investor: { id: 'inv-1', legal_name: 'Alpha', rif: 'J-1' },
    investor_capital: '100000.0000',
    annual_rate: '0.130000',
    term_days: 42,
    price: '0.984833',
    nominal_target: '101540.6000',
    nominal_actual: '101540.0000',
    investor_paid: '99999.4100',
    investor_returned: '0.5900',
    investor_yield: '1540.5900',
    shortfall_pct: '0.000006',
    issue_date: '2026-04-27',
    maturity_date: '2026-06-08',
    cycle_week: '2026-W18',
    issued_by: { id: 'u-1', email: 'op@x.com', full_name: 'María R.' },
    created_at: '2026-04-27T14:30:00Z',
    payload_hash: 'h',
    cancellation: null,
    orders: [
      { id: 'o-1', external_order_id: '1', merchant: { id: 'm-1', current_name: 'Merch', rif: 'J-1' }, purchase_date: '2026-04-20', max_due_date: '2026-05-31', installments_sum_snapshot: '100.0000', assigned_at: '2026-04-27T14:30:00Z', installments: [] },
      { id: 'o-2', external_order_id: '2', merchant: { id: 'm-2', current_name: 'Merch2', rif: 'J-2' }, purchase_date: '2026-04-20', max_due_date: '2026-05-31', installments_sum_snapshot: '200.0000', assigned_at: '2026-04-27T14:30:00Z', installments: [] },
    ],
    events: [],
    ...over,
  };
}

describe('<CertHeroStrip />', () => {
  it('renders all 5 cards with formatted values', () => {
    render(<CertHeroStrip cert={mockCert()} />);
    expect(screen.getByText('CAPITAL')).toBeInTheDocument();
    expect(screen.getByText('$100,000.00')).toBeInTheDocument();
    expect(screen.getByText(/residual.*\$0\.59/)).toBeInTheDocument();
    expect(screen.getByText('TASA')).toBeInTheDocument();
    expect(screen.getByText('13.0%')).toBeInTheDocument();
    expect(screen.getByText(/\$1,540\.59.*vencimiento/)).toBeInTheDocument();
    expect(screen.getByText('PLAZO')).toBeInTheDocument();
    expect(screen.getByText('42d')).toBeInTheDocument();
    expect(screen.getByText(/vence 08\/06\/2026/i)).toBeInTheDocument();
    expect(screen.getByText('COMPOSICIÓN')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();   // orders.length
    expect(screen.getByText(/[oó]rdenes/i)).toBeInTheDocument();
    expect(screen.getByText('ESTADO')).toBeInTheDocument();
    expect(screen.getByText(/Activo/)).toBeInTheDocument();
  });

  it('shows cancelled sub-label when status is cancelled', () => {
    render(
      <CertHeroStrip
        cert={mockCert({
          status: 'cancelled',
          cancellation: {
            cancelled_at: '2026-05-01T10:00:00Z',
            cancelled_by: null,
            reason: 'test',
          },
        })}
      />,
    );
    expect(screen.getByText(/cancelado.*01\/05\/2026/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/certificates/cert-hero-strip.test.tsx
```

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/certificates/cert-hero-strip.tsx`:

```tsx
import { fmtMoney2 } from '@/lib/format/money';
import { fmtPct } from '@/lib/format/percent';
import { fmtDate } from '@/lib/format/date';
import { daysSince } from '@/lib/format/cycle-day';
import type { CertificateDetail } from '@/lib/types/certificate';

interface Props {
  cert: CertificateDetail;
}

export function CertHeroStrip({ cert }: Props) {
  const merchantCount = new Set(cert.orders.map((o) => o.merchant.id)).size;
  const yieldFormatted = `${fmtMoney2(Number(cert.investor_yield))} al vencimiento`;
  const residualSub = `residual ${fmtMoney2(Number(cert.investor_returned))}`;
  const day = daysSince(cert.issue_date);

  let statusLabel = '';
  let statusSub = '';
  if (cert.status === 'issued') {
    statusLabel = '● Activo';
    statusSub = `día ${day} de ${cert.term_days}`;
  } else if (cert.status === 'matured') {
    statusLabel = '● Vencido';
    statusSub = `vencido ${fmtDate(cert.maturity_date)}`;
  } else if (cert.status === 'cancelled') {
    statusLabel = '● Cancelado';
    const at = cert.cancellation?.cancelled_at ?? cert.created_at;
    statusSub = `cancelado ${fmtDate(at)}`;
  } else {
    statusLabel = '● Borrador';
    statusSub = '';
  }

  return (
    <div className="bg-card border-border-subtle grid grid-cols-2 gap-4 rounded-xl border p-5 md:grid-cols-5">
      <Card label="CAPITAL" value={fmtMoney2(Number(cert.investor_capital))} sub={residualSub} />
      <Card label="TASA" value={fmtPct(cert.annual_rate)} sub={yieldFormatted} />
      <Card label="PLAZO" value={`${cert.term_days}d`} sub={`vence ${fmtDate(cert.maturity_date)}`} />
      <Card label="COMPOSICIÓN" value={String(cert.orders.length)} sub={`órdenes · ${merchantCount} comercios`} />
      <Card label="ESTADO" value={statusLabel} sub={statusSub} />
    </div>
  );
}

function Card({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <div className="text-text-3 mb-1 text-[10px] uppercase tracking-wide">{label}</div>
      <div className="text-[20px] font-semibold tabular-nums tracking-[-0.3px]">{value}</div>
      <div className="text-text-3 mt-0.5 text-[11px] tabular-nums">{sub}</div>
    </div>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/certificates/cert-hero-strip.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/certificates/cert-hero-strip.tsx components/certificates/cert-hero-strip.test.tsx
git commit -m "$(cat <<'EOF'
feat(certificates): CertHeroStrip

5-card hero: Capital · Tasa · Plazo · Composición · Estado. Status
card sub-label adapts per status (día N de M / vencido / cancelado).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: `<CertOrdersTable>`

**Files:**
- Create: `components/certificates/cert-orders-table.tsx`
- Create: `components/certificates/cert-orders-table.test.tsx`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/components/certificates/cert-orders-table.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CertOrdersTable } from './cert-orders-table';
import type { CertificateOrder } from '@/lib/types/certificate';

const orders: CertificateOrder[] = [
  {
    id: 'o-1',
    external_order_id: '85657474',
    merchant: { id: 'm-1', current_name: 'CENTRAL MADEIRENSE', rif: 'J-1' },
    purchase_date: '2026-03-18',
    max_due_date: '2026-04-03',
    installments_sum_snapshot: '87.2400',
    assigned_at: '2026-04-27T14:30:00Z',
    installments: [
      { installment_number: 1, amount: '29.08', due_date: '2026-04-03', status: 'pending' },
      { installment_number: 2, amount: '29.08', due_date: '2026-04-10', status: 'pending' },
      { installment_number: 3, amount: '29.08', due_date: '2026-04-17', status: 'pending' },
    ],
  },
  {
    id: 'o-2',
    external_order_id: '85656105',
    merchant: { id: 'm-2', current_name: 'GRUPO CANALETTO', rif: 'J-2' },
    purchase_date: '2026-03-18',
    max_due_date: '2026-04-03',
    installments_sum_snapshot: '26.0700',
    assigned_at: '2026-04-27T14:30:00Z',
    installments: [
      { installment_number: 1, amount: '26.07', due_date: '2026-04-03', status: 'pending' },
    ],
  },
];

describe('<CertOrdersTable />', () => {
  it('renders all orders with formatted values + total footer', () => {
    render(<CertOrdersTable orders={orders} />);
    expect(screen.getByText('85657474')).toBeInTheDocument();
    expect(screen.getByText('CENTRAL MADEIRENSE')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();          // cuotas count
    expect(screen.getByText('$87.24')).toBeInTheDocument();
    expect(screen.getByText('85656105')).toBeInTheDocument();
    expect(screen.getByText('GRUPO CANALETTO')).toBeInTheDocument();
    expect(screen.getByText(/total del pool.*\$113\.31.*2 [oó]rdenes.*4 cuotas/i)).toBeInTheDocument();
  });

  it('shows empty state for empty pool', () => {
    render(<CertOrdersTable orders={[]} />);
    expect(screen.getByText(/sin [oó]rdenes/i)).toBeInTheDocument();
  });

  it('filters by substring on order code or merchant', () => {
    render(<CertOrdersTable orders={orders} />);
    fireEvent.change(screen.getByPlaceholderText(/id o comercio/i), { target: { value: 'canaletto' } });
    expect(screen.getByText('GRUPO CANALETTO')).toBeInTheDocument();
    expect(screen.queryByText('CENTRAL MADEIRENSE')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/certificates/cert-orders-table.test.tsx
```

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/certificates/cert-orders-table.tsx`:

```tsx
'use client';

import { useState, useMemo } from 'react';
import { fmtDate } from '@/lib/format/date';
import { fmtMoney2 } from '@/lib/format/money';
import type { CertificateOrder } from '@/lib/types/certificate';

interface Props {
  orders: CertificateOrder[];
}

export function CertOrdersTable({ orders }: Props) {
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    if (!q.trim()) return orders;
    const needle = q.toLowerCase().trim();
    return orders.filter(
      (o) =>
        o.external_order_id.toLowerCase().includes(needle) ||
        o.merchant.current_name.toLowerCase().includes(needle),
    );
  }, [orders, q]);

  if (orders.length === 0) {
    return (
      <div className="border-border-subtle bg-card flex h-48 items-center justify-center rounded-xl border">
        <div className="text-text-3 text-sm">Sin órdenes en este pool.</div>
      </div>
    );
  }

  const totalAmount = filtered.reduce(
    (acc, o) => acc + Number(o.installments_sum_snapshot),
    0,
  );
  const totalInstallments = filtered.reduce((acc, o) => acc + o.installments.length, 0);

  return (
    <div className="bg-card border-border-subtle overflow-hidden rounded-xl border">
      <div className="border-border-subtle flex items-center gap-3 border-b px-4 py-3">
        <input
          type="search"
          placeholder="🔎 ID o comercio"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="border-border-subtle bg-card flex-1 rounded-md border px-3 py-1.5 text-[12px]"
        />
        <span className="text-text-3 text-[11px]">
          {filtered.length} de {orders.length}
        </span>
      </div>
      <table className="w-full text-[12px]">
        <thead className="bg-subtle">
          <tr>
            <Th>ID</Th>
            <Th>Comercio</Th>
            <Th align="right">Cuotas</Th>
            <Th>Compra</Th>
            <Th>Últ. vence</Th>
            <Th align="right">Monto</Th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((o) => (
            <tr key={o.id} className="border-border-soft hover:bg-subtle border-b">
              <td className="text-text-2 px-4 py-3 font-mono text-[11.5px]">
                {o.external_order_id}
              </td>
              <td className="max-w-[260px] truncate px-4 py-3" title={o.merchant.current_name}>
                {o.merchant.current_name}
              </td>
              <td className="num px-4 py-3 text-right">{o.installments.length}</td>
              <td className="num px-4 py-3">{fmtDate(o.purchase_date)}</td>
              <td className="num px-4 py-3">{fmtDate(o.max_due_date)}</td>
              <td className="num px-4 py-3 text-right font-medium">
                {fmtMoney2(Number(o.installments_sum_snapshot))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="bg-subtle border-border-subtle border-t px-4 py-3 text-[11.5px]">
        <span className="font-medium">Total del pool: </span>
        <span className="tabular-nums">
          {fmtMoney2(totalAmount)} · {filtered.length} órdenes · {totalInstallments} cuotas
        </span>
      </div>
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  const alignClass = align === 'right' ? 'text-right' : 'text-left';
  return (
    <th
      className={`text-text-3 border-border-subtle border-b px-4 py-2 ${alignClass} text-[9.5px] font-medium tracking-[0.7px] uppercase`}
    >
      {children}
    </th>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/certificates/cert-orders-table.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/certificates/cert-orders-table.tsx components/certificates/cert-orders-table.test.tsx
git commit -m "$(cat <<'EOF'
feat(certificates): CertOrdersTable

Pool orders table with substring filter (ID or comercio). All orders
rendered client-side (no pagination — back returns them embedded in
detail). Footer shows totals for the filtered set.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: `<CertAuditSidebar>`

**Files:**
- Create: `components/certificates/cert-audit-sidebar.tsx`
- Create: `components/certificates/cert-audit-sidebar.test.tsx`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/components/certificates/cert-audit-sidebar.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CertAuditSidebar } from './cert-audit-sidebar';
import type { CertificateDetail } from '@/lib/types/certificate';

function mockCert(over: Partial<CertificateDetail> = {}): CertificateDetail {
  return {
    id: 'c-1',
    certificate_code: 'C4572A',
    certificate_type: 'standard',
    status: 'issued',
    investor: { id: 'inv-1', legal_name: 'Inversora Alpha, C.A.', rif: 'J-12345678-9' },
    investor_capital: '100000.0000',
    annual_rate: '0.130000',
    term_days: 42,
    price: '0.984833',
    nominal_target: '101540.6000',
    nominal_actual: '101540.0000',
    investor_paid: '99999.4100',
    investor_returned: '0.5900',
    investor_yield: '1540.5900',
    shortfall_pct: '0.000006',
    issue_date: '2026-04-27',
    maturity_date: '2026-06-08',
    cycle_week: '2026-W18',
    issued_by: { id: 'u-1', email: 'op@x.com', full_name: 'María R.' },
    created_at: '2026-04-27T14:30:00Z',
    payload_hash: 'h',
    cancellation: null,
    orders: [],
    events: [
      { id: 'e-1', event_type: 'issued', occurred_at: '2026-04-27T14:30:00Z', payload: {}, actor_id: 'u-1' },
      { id: 'e-2', event_type: 'simulated', occurred_at: '2026-04-27T14:00:00Z', payload: {}, actor_id: 'u-1' },
    ],
    ...over,
  };
}

describe('<CertAuditSidebar />', () => {
  it('renders investor info block', () => {
    render(<CertAuditSidebar cert={mockCert()} />);
    expect(screen.getByText('INVERSOR')).toBeInTheDocument();
    expect(screen.getByText('Inversora Alpha, C.A.')).toBeInTheDocument();
    expect(screen.getByText('J-12345678-9')).toBeInTheDocument();
  });

  it('renders 3 verified rules with ✓', () => {
    render(<CertAuditSidebar cert={mockCert()} />);
    expect(screen.getByText(/reglas/i)).toBeInTheDocument();
    expect(screen.getByText(/Vencimientos ≤ certificado/i)).toBeInTheDocument();
    expect(screen.getByText(/[oó]rdenes indivisibles/i)).toBeInTheDocument();
    expect(screen.getByText(/redondeo hacia abajo/i)).toBeInTheDocument();
  });

  it('renders audit events with formatted timestamps', () => {
    render(<CertAuditSidebar cert={mockCert()} />);
    expect(screen.getByText(/issued/)).toBeInTheDocument();
    expect(screen.getByText(/simulated/)).toBeInTheDocument();
  });

  it('shows empty state for events when none', () => {
    render(<CertAuditSidebar cert={mockCert({ events: [] })} />);
    expect(screen.getByText(/sin eventos/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/certificates/cert-audit-sidebar.test.tsx
```

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/certificates/cert-audit-sidebar.tsx`:

```tsx
import { fmtDate } from '@/lib/format/date';
import type { CertificateDetail, CertificateEvent } from '@/lib/types/certificate';

interface Props {
  cert: CertificateDetail;
}

const EVENT_LIMIT = 10;

export function CertAuditSidebar({ cert }: Props) {
  const events = cert.events.slice(0, EVENT_LIMIT);
  return (
    <div className="flex flex-col gap-6">
      <Block title="INVERSOR">
        <KV k="Razón social" v={cert.investor.legal_name} />
        <KV k="RIF" v={cert.investor.rif} mono last />
      </Block>

      <Block title="REGLAS VERIFICADAS">
        <KV k="Vencimientos ≤ certificado" v={<Check />} />
        <KV k="Órdenes indivisibles" v={<Check />} />
        <KV k="Redondeo hacia abajo" v={<Check />} last />
      </Block>

      <Block title="AUDITORÍA">
        {events.length === 0 ? (
          <div className="text-text-3 py-2 text-[11px] italic">Sin eventos registrados.</div>
        ) : (
          events.map((e, i) => <EventRow key={e.id} event={e} last={i === events.length - 1} />)
        )}
      </Block>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border-border-subtle rounded-lg border p-4">
      <div className="text-text-3 mb-3 text-[10px] uppercase tracking-wide">{title}</div>
      {children}
    </div>
  );
}

function KV({
  k,
  v,
  mono = false,
  last = false,
}: {
  k: string;
  v: React.ReactNode;
  mono?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={
        'flex items-center justify-between gap-3 py-1.5 text-[12px] ' +
        (last ? '' : 'border-border-soft border-b')
      }
    >
      <span className="text-text-3">{k}</span>
      <span
        className={'text-text-2 font-medium tabular-nums ' + (mono ? 'font-mono' : '')}
      >
        {v}
      </span>
    </div>
  );
}

function Check() {
  return <span className="text-green-text text-[14px]">✓</span>;
}

function EventRow({ event, last }: { event: CertificateEvent; last: boolean }) {
  return (
    <div
      className={
        'flex gap-3 py-2 ' + (last ? '' : 'border-border-soft border-b')
      }
    >
      <div className="bg-text-3 mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full" />
      <div className="text-[11px] leading-snug">
        <div>
          <b className="text-text-2 font-medium">{event.event_type}</b>
        </div>
        <div className="text-text-3 tabular-nums mt-0.5 text-[10px]">
          {fmtDate(event.occurred_at)}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/certificates/cert-audit-sidebar.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/certificates/cert-audit-sidebar.tsx components/certificates/cert-audit-sidebar.test.tsx
git commit -m "$(cat <<'EOF'
feat(certificates): CertAuditSidebar

Three blocks: Inversor (legal_name + RIF), Reglas verificadas (3 ✓),
Auditoría (top 10 events). Empty state for events when none.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: `<CancelCertModal>`

**Files:**
- Create: `components/certificates/cancel-cert-modal.tsx`
- Create: `components/certificates/cancel-cert-modal.test.tsx`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/components/certificates/cancel-cert-modal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from '@/test/helpers/tanstack';
import { CancelCertModal } from './cancel-cert-modal';

const { mockCancel, toastSuccess, toastError } = vi.hoisted(() => ({
  mockCancel: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/lib/api/certificates', () => ({
  cancelCertificate: (...a: unknown[]) => mockCancel(...a),
}));

vi.mock('sonner', () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

describe('<CancelCertModal />', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders title with code + irreversibility warning', () => {
    renderWithQuery(
      <CancelCertModal certId="c-1" certCode="C4572A" orderCount={343} onClose={vi.fn()} />,
    );
    expect(screen.getByText(/cancelar certificado c4572a/i)).toBeInTheDocument();
    expect(screen.getByText(/no puede deshacerse/i)).toBeInTheDocument();
    expect(screen.getByText(/343 [oó]rdenes/i)).toBeInTheDocument();
  });

  it('disables Confirmar when reason < 5 chars', () => {
    renderWithQuery(
      <CancelCertModal certId="c-1" certCode="C4572A" orderCount={1} onClose={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /confirmar/i })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'abc' } });
    expect(screen.getByRole('button', { name: /confirmar/i })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'abcde' } });
    expect(screen.getByRole('button', { name: /confirmar/i })).not.toBeDisabled();
  });

  it('shows character counter', () => {
    renderWithQuery(
      <CancelCertModal certId="c-1" certCode="C4572A" orderCount={1} onClose={vi.fn()} />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hola' } });
    expect(screen.getByText(/4.*\/.*1000/)).toBeInTheDocument();
  });

  it('on Confirmar: calls cancelCertificate + toast + close', async () => {
    mockCancel.mockResolvedValueOnce({ certificate_code: 'C4572A', status: 'cancelled' });
    const onClose = vi.fn();
    renderWithQuery(
      <CancelCertModal certId="c-1" certCode="C4572A" orderCount={1} onClose={onClose} />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Cliente solicitó baja' } });
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));
    await waitFor(() => expect(mockCancel).toHaveBeenCalledWith('c-1', 'Cliente solicitó baja'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining('C4572A'));
  });

  it('on error: toast error + modal stays open', async () => {
    mockCancel.mockRejectedValueOnce(new Error('Solo se puede cancelar issued'));
    const onClose = vi.fn();
    renderWithQuery(
      <CancelCertModal certId="c-1" certCode="C4572A" orderCount={1} onClose={onClose} />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'razón válida' } });
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('clicking backdrop calls onClose', () => {
    const onClose = vi.fn();
    const { container } = renderWithQuery(
      <CancelCertModal certId="c-1" certCode="C4572A" orderCount={1} onClose={onClose} />,
    );
    fireEvent.click(container.querySelector('[data-testid="cancel-modal-backdrop"]')!);
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/certificates/cancel-cert-modal.test.tsx
```

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/certificates/cancel-cert-modal.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { cancelCertificate } from '@/lib/api/certificates';

const MIN = 5;
const MAX = 1000;

interface Props {
  certId: string;
  certCode: string;
  orderCount: number;
  onClose: () => void;
}

export function CancelCertModal({ certId, certCode, orderCount, onClose }: Props) {
  const [reason, setReason] = useState('');
  const qc = useQueryClient();

  const mut = useMutation({
    mutationFn: (r: string) => cancelCertificate(certId, r),
    onSuccess: (cert) => {
      qc.invalidateQueries({ queryKey: ['certificate', certId] });
      qc.invalidateQueries({ queryKey: ['certificates'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['orders-stats'] });
      toast.success(`Certificado ${cert.certificate_code} cancelado`);
      onClose();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Error al cancelar');
    },
  });

  const trimmed = reason.trim();
  const canSubmit = trimmed.length >= MIN && trimmed.length <= MAX && !mut.isPending;

  return (
    <div
      data-testid="cancel-modal-backdrop"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-card mt-24 w-full max-w-[520px] overflow-hidden rounded-xl"
      >
        <header className="border-border-subtle flex items-start justify-between border-b px-6 py-4">
          <h2 className="text-[16px] font-semibold tracking-[-0.2px]">
            Cancelar certificado {certCode}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="bg-subtle text-text-2 flex h-7 w-7 items-center justify-center rounded-md text-[14px]"
          >
            ×
          </button>
        </header>
        <div className="flex flex-col gap-3 px-6 py-5">
          <div className="bg-warn-bg text-warn-text rounded-md px-3 py-2 text-[12px]">
            ⚠️ Esta acción NO puede deshacerse. Las {orderCount} órdenes vuelven a
            estado &apos;disponible&apos;.
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-text-3 text-[11px]">
              Motivo de la cancelación (requerido)
            </span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={MAX}
              rows={4}
              className="border-border-subtle bg-card resize-none rounded-md border px-3 py-2 text-[12px]"
            />
          </label>
          <div className="text-text-3 text-[10px] tabular-nums">
            {trimmed.length} / {MAX} caracteres · mínimo {MIN}
          </div>
        </div>
        <div className="border-border-subtle bg-card flex items-center justify-end gap-2 border-t px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={mut.isPending}
            className="border-border-subtle bg-card text-text-2 hover:bg-subtle rounded-md border px-3 py-1.5 text-[12px] font-medium disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => mut.mutate(trimmed)}
            disabled={!canSubmit}
            className="bg-foreground text-background rounded-md px-3 py-1.5 text-[12px] font-medium disabled:opacity-40"
          >
            {mut.isPending ? 'Cancelando…' : 'Confirmar cancelación'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/certificates/cancel-cert-modal.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/certificates/cancel-cert-modal.tsx components/certificates/cancel-cert-modal.test.tsx
git commit -m "$(cat <<'EOF'
feat(certificates): CancelCertModal

Modal con textarea reason (5-1000 chars, validated client-side),
warning banner about irreversibility, mutation that invalidates
['certificate', id] + ['certificates'] + ['orders'] + ['orders-stats']
on success.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: `<CertificateDetailPage>` orchestrator

**Files:**
- Create: `components/certificates/certificate-detail-page.tsx`
- Create: `components/certificates/certificate-detail-page.test.tsx`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/components/certificates/certificate-detail-page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithQuery } from '@/test/helpers/tanstack';
import { CertificateDetailPage } from './certificate-detail-page';
import { UserProvider } from '@/lib/auth/user-context';
import type { CertificateDetail } from '@/lib/types/certificate';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));

vi.mock('@/lib/api/certificates', () => ({
  getCertificateDetail: (...a: unknown[]) => mockGet(...a),
  cancelCertificate: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function mockCert(over: Partial<CertificateDetail> = {}): CertificateDetail {
  return {
    id: 'c-1',
    certificate_code: 'C4572A',
    certificate_type: 'standard',
    status: 'issued',
    investor: { id: 'inv-1', legal_name: 'Inversora Alpha, C.A.', rif: 'J-12345678-9' },
    investor_capital: '100000.0000',
    annual_rate: '0.130000',
    term_days: 42,
    price: '0.984833',
    nominal_target: '101540.6000',
    nominal_actual: '101540.0000',
    investor_paid: '99999.4100',
    investor_returned: '0.5900',
    investor_yield: '1540.5900',
    shortfall_pct: '0.000006',
    issue_date: '2026-04-27',
    maturity_date: '2026-06-08',
    cycle_week: '2026-W18',
    issued_by: { id: 'u-1', email: 'op@x.com', full_name: 'María R.' },
    created_at: '2026-04-27T14:30:00Z',
    payload_hash: 'h',
    cancellation: null,
    orders: [],
    events: [],
    ...over,
  };
}

const operator = {
  id: 'u-1',
  email: 'op@x.com',
  full_name: 'Op',
  role: 'operator' as const,
  is_active: true,
};

function wrap(ui: React.ReactElement) {
  return renderWithQuery(<UserProvider user={operator}>{ui}</UserProvider>);
}

describe('<CertificateDetailPage />', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows loading state initially', () => {
    mockGet.mockImplementation(() => new Promise(() => {}));
    wrap(<CertificateDetailPage id="c-1" />);
    expect(screen.getByText(/cargando/i)).toBeInTheDocument();
  });

  it('shows 404 empty state when fetch errors', async () => {
    mockGet.mockRejectedValueOnce(new Error('not found'));
    wrap(<CertificateDetailPage id="c-1" />);
    await waitFor(() =>
      expect(screen.getByText(/certificado no encontrado/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole('link', { name: /volver al listado/i })).toHaveAttribute(
      'href',
      '/certificates',
    );
  });

  it('renders header + hero + body when data arrives', async () => {
    mockGet.mockResolvedValueOnce(mockCert());
    wrap(<CertificateDetailPage id="c-1" />);
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: /inversora alpha/i })).toBeInTheDocument(),
    );
    expect(screen.getByText('CAPITAL')).toBeInTheDocument();
    expect(screen.getByText('INVERSOR')).toBeInTheDocument();
  });

  it('opens cancel modal on header button click', async () => {
    mockGet.mockResolvedValueOnce(mockCert());
    wrap(<CertificateDetailPage id="c-1" />);
    await waitFor(() => expect(screen.getByRole('button', { name: /cancelar certificado/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /cancelar certificado/i }));
    expect(screen.getByText(/cancelar certificado c4572a/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/certificates/certificate-detail-page.test.tsx
```

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/certificates/certificate-detail-page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { getCertificateDetail } from '@/lib/api/certificates';
import { CertHeader } from './cert-header';
import { CertHeroStrip } from './cert-hero-strip';
import { CertOrdersTable } from './cert-orders-table';
import { CertAuditSidebar } from './cert-audit-sidebar';
import { CancelCertModal } from './cancel-cert-modal';

interface Props {
  id: string;
}

export function CertificateDetailPage({ id }: Props) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['certificate', id],
    queryFn: () => getCertificateDetail(id),
    staleTime: 30 * 1000,
  });

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-[1440px] px-9 py-7">
        <div className="text-text-3 py-24 text-center text-sm">Cargando certificado…</div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="mx-auto w-full max-w-[1440px] px-9 py-7">
        <div className="border-border-subtle bg-card flex flex-col items-center gap-3 rounded-xl border py-24">
          <div className="text-text-2 text-sm">Certificado no encontrado.</div>
          <Link
            href="/certificates"
            className="border-border-subtle rounded border px-3 py-1 text-[12px]"
          >
            Volver al listado
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] px-9 py-7">
      <CertHeader cert={data} onCancel={() => setCancelOpen(true)} />
      <div className="mt-5 flex flex-col gap-5">
        <CertHeroStrip cert={data} />
        <div className="grid grid-cols-1 gap-5 md:grid-cols-[1fr_320px]">
          <CertOrdersTable orders={data.orders} />
          <CertAuditSidebar cert={data} />
        </div>
      </div>
      {cancelOpen && (
        <CancelCertModal
          certId={data.id}
          certCode={data.certificate_code}
          orderCount={data.orders.length}
          onClose={() => setCancelOpen(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/certificates/certificate-detail-page.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/certificates/certificate-detail-page.tsx components/certificates/certificate-detail-page.test.tsx
git commit -m "$(cat <<'EOF'
feat(certificates): CertificateDetailPage orchestrator

Loading / 404 / data states. Composes header + hero + 2-col body
(orders table + audit sidebar). Mounts the cancel modal on demand.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Wire `app/(app)/certificates/[id]/page.tsx`

**Files:**
- Create: `app/(app)/certificates/[id]/page.tsx`

- [ ] **Step 1: Create the route file**

Create `/Users/llam/dev/araguaney_front/app/(app)/certificates/[id]/page.tsx`:

```tsx
import { CertificateDetailPage } from '@/components/certificates/certificate-detail-page';

interface Params {
  params: Promise<{ id: string }>;
}

export default async function CertificateDetailRoute({ params }: Params) {
  const { id } = await params;
  return <CertificateDetailPage id={id} />;
}
```

Note: Next.js 16 App Router treats `params` as a Promise. The `await` is required.

- [ ] **Step 2: Verify + build**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
pnpm build
```

Expected: build succeeds. `/certificates/[id]` should be listed as `ƒ` (dynamic).

- [ ] **Step 3: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add "app/(app)/certificates/[id]/page.tsx"
git commit -m "$(cat <<'EOF'
feat(certificates): wire /certificates/[id] detail route

Server Component shell awaits the params promise (Next.js 16 App
Router convention) and mounts the client orchestrator.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: Local smoke + visual sanity

**Files:** none (verification only).

- [ ] **Step 1: Boot dev**

```bash
cd /Users/llam/dev/araguaney_front
lsof -ti:3000 | xargs kill -9 2>/dev/null
pnpm dev > /tmp/front-task18.log 2>&1 &
PID=$!
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if grep -q "Ready in" /tmp/front-task18.log 2>/dev/null; then echo "ready in ${i}s"; break; fi
  sleep 1
done
```

- [ ] **Step 2: Verify route gating**

```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3000/certificates
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3000/certificates/some-id
```

Both expected: 307 → `/login`.

- [ ] **Step 3: Visual smoke (manual)**

This is for the user to do post-deploy. Document the steps so they can replay:

1. Login as operator → `/stock` → "+ Nuevo certificado" → emit a small one (capital $1000, 13%, 42d).
2. Toast verde con código real (no "undefined" — that's the Task 1 bugfix).
3. Sidebar → "Certificados" → land on `/certificates`.
4. Ver la fila del recién emitido (status "Activo").
5. Filtros: cambiar a "Cancelados" → vacío. Volver a "Activos" → fila visible. Buscar por código → filtra.
6. Click la fila → `/certificates/{id}` detail.
7. Header: breadcrumb, título inversor, code pill, status pill, botón "Cancelar certificado" visible.
8. Hero strip: 5 cards con valores reales.
9. Sidebar: investor info + 3 reglas ✓ + audit events.
10. Orders table: las del pool. Buscar substring → filtra.
11. Click "Cancelar certificado" → modal abre.
12. Escribir reason corto (4 chars) → Confirmar disabled.
13. Escribir reason válido → Confirmar → modal cierra, toast verde, detail muestra pill "Cancelado", botón Cancelar desaparece.
14. Login como auditor → /certificates → detail accesible. NO ve botón Cancelar.

- [ ] **Step 4: Stop dev**

```bash
kill $PID; wait $PID 2>/dev/null
```

- [ ] **Step 5: No commit**

---

## Task 19: Push branch + open PR

**Files:** none.

- [ ] **Step 1: Push**

```bash
cd /Users/llam/dev/araguaney_front
git push -u origin feat/slice-5-certificates
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "feat: Slice 5 — /certificates list + detail + cancel" --body "$(cat <<'EOF'
## Summary

Cierra el loop "crear → ver → cancelar" para certificados bursátiles.

- `/certificates` con lista paginada + filtros (status pills, inversor, fecha emisión rango, búsqueda por código)
- `/certificates/[id]` con header + hero strip (5 cards) + tabla de órdenes del pool + sidebar (inversor + reglas verificadas + audit timeline)
- Botón Cancelar certificado (gated en `certificate.cancel`) → modal con textarea reason (5-1000 chars) → POST /api/certificates/:id/cancel
- **Bugfix Slice 4**: el `Certificate` type usaba `code` / `capital` / `rate` cuando el back devuelve `certificate_code` / `investor_capital` / `annual_rate`. El toast del wizard probablemente decía "Certificado undefined emitido" en producción. Task 1 lo corrige.

## What's new

- `lib/types/certificate.ts` — renombrar a wire shape, agregar CertificateSummary/Detail/Order/Event/Cancellation
- `lib/format/cycle-day.ts` — `daysSince` helper
- `lib/api/certificates.ts` — listCertificates, getCertificateDetail, cancelCertificate
- `lib/permissions/has-permission.ts` — agregar `certificate.cancel`
- 11 componentes nuevos en `components/certificates/`
- `app/(app)/certificates/page.tsx` (modify), `app/(app)/certificates/[id]/page.tsx` (create)
- Bugfix del toast en wizard Step3

## Test Plan

- [x] `pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check && pnpm build` — todo clean
- [x] ~62 nuevos tests pasando
- [ ] Vercel preview deploy renders sin console errors
- [ ] Flow end-to-end en producción: emit → ver en lista → click → detail → cancelar
- [ ] Auditor no ve botón Cancelar

## Notes

- Tabs Cuotas / Calendario / Comercios → out of scope (data ya embebida)
- Botones Exportar Excel / PDF / Liberar al vencimiento → no hay endpoints
- URL legible (`/certificates/C4572A`) → ugly UUID URL por ahora; back tiene `:id` con ParseUUIDPipe
- Sweep certificate → flujo aparte

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

If `gh` fails on "must be a collaborator", surface the URL.

- [ ] **Step 3: Watch CI**

```bash
until gh run list --repo armandogois-lab/araguaney_front --limit 1 --json status -q '.[0].status' | grep -q completed; do sleep 5; done
gh run list --repo armandogois-lab/araguaney_front --limit 1
```

Expected: green ✓.

---

## Self-Review

**Spec coverage:**

- ✅ List page con filtros + paginación — Tasks 5-10
- ✅ Detail page con header + hero + orders + sidebar — Tasks 11-17
- ✅ Cancel modal con reason validation — Task 15
- ✅ Type correction de Slice 4 + wizard toast fix — Task 1
- ✅ cycle-day helper — Task 2
- ✅ Server Actions (list/detail/cancel) — Task 3
- ✅ Permission certificate.cancel — Task 4
- ✅ Loading / empty / error states — Tasks 8, 13, 16
- ✅ Status pill mapping con 4 estados — Task 5
- ✅ Click row → router.push — Task 6
- ✅ Reglas verificadas (3 ✓) en sidebar — Task 14
- ✅ Audit events top 10 — Task 14
- ✅ Cancel button gated por permission + status — Task 11
- ✅ Smoke + PR — Tasks 18-19

**Placeholder scan:** No `TODO`/`TBD`/`fill in` markers. The user-facing smoke plan in Task 18 is verification documentation, not an implementation placeholder.

**Type consistency:**
- `CertificateSummary` (Task 1) used in tasks 6, 8 (table rows + list response data)
- `CertificateDetail` (Task 1) used in tasks 11, 12, 13, 14, 16 (the orchestrator + 4 child components)
- `CertificateOrder` (Task 1) used in task 13
- `CertificateEvent` (Task 1) used in task 14
- `CertificateFiltersValue` (Task 7) used in tasks 8 and 9
- `ListCertificatesQuery` (Task 3) consumed in task 8
- `cancellation` field shape (Task 1: `Cancellation`) used in task 12 (hero status sub-label)
- `MIN/MAX` constants in cancel modal (Task 15) match the back's reason validation (5-1000)

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-10-front-slice-5-certificates-list-detail.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Fresh subagent per task + two-stage review.

**2. Inline Execution** — Same session with batch checkpoints.

**Which approach?**
