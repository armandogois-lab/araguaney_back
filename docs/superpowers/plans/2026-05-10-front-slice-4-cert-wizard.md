# araguaney_front Slice 4 — Wizard de Nuevo Certificado Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a 3-step modal wizard on `/stock` that lets a Tesorería operator emit a certificate: pick investor → simulate pool with parameters → confirm. Closes the "I have stock, package it into a CFB" loop opened by Slice 3.

**Architecture:** Modal mounted from a button in `<StockPage>`. State lives in a `useReducer` inside `<NewCertWizard>` orchestrator. Three step components consume slices of state and dispatch actions. Each Step 2 preview panel is its own small component for testability. Server Actions wrap simulate/issue/investor endpoints; mutations invalidate the Stock page's queries on success.

**Tech Stack:** Next.js 16 App Router (existing), TanStack Query v5 (existing), shadcn/ui base-nova primitives, sonner for toasts, Vitest + Testing Library, hand-typed response shapes.

**Spec:** `/Users/llam/dev/araguaney_back/docs/superpowers/specs/2026-05-10-front-slice-4-cert-wizard-design.md`

**Working directory note:** all front code lives in `/Users/llam/dev/araguaney_front/`. The plan and spec live in `/Users/llam/dev/araguaney_back/docs/`. Implementer must `cd /Users/llam/dev/araguaney_front` for any task command.

**Pre-req branch:** Work on `feat/slice-4-cert-wizard` (Task 1 creates this from `main`; subsequent tasks just commit to it).

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `lib/types/investor.ts` | create | `InvestorKind`, `InvestorStatus`, `InvestorSummary`, `InvestorsListResponse`, `InvestorCreate` |
| `lib/types/certificate.ts` | create | `CertificateStatus`, `Certificate`, `SimulationResult` + sub-types |
| `lib/format/percent.ts` | create | `fmtPct(value, decimals?)` |
| `lib/format/percent.test.ts` | create | Tests |
| `lib/api/investors.ts` | create | Server Actions: `listInvestors`, `createInvestor` |
| `lib/api/investors.test.ts` | create | Tests |
| `lib/api/certificates.ts` | modify | Add `simulateCertificate`, `issueCertificate` (existing: `countCertificatesIssued`) |
| `lib/api/certificates.test.ts` | modify | Add tests |
| `components/cert-wizard/wizard-state.ts` | create | Reducer + actions + initial state (pure) |
| `components/cert-wizard/wizard-state.test.ts` | create | Reducer tests |
| `components/cert-wizard/step-indicator.tsx` | create | Visual 1·2·3 with done/active/pending |
| `components/cert-wizard/step-indicator.test.tsx` | create | Tests |
| `components/cert-wizard/wizard-footer.tsx` | create | Buttons per step |
| `components/cert-wizard/wizard-footer.test.tsx` | create | Tests |
| `components/cert-wizard/investor-list.tsx` | create | Search + paginated list of existing investors |
| `components/cert-wizard/investor-list.test.tsx` | create | Tests |
| `components/cert-wizard/investor-create-form.tsx` | create | Form for new investor + mutation |
| `components/cert-wizard/investor-create-form.test.tsx` | create | Tests |
| `components/cert-wizard/step1-investor.tsx` | create | Tabs Existente/Nuevo, composes list + form |
| `components/cert-wizard/step1-investor.test.tsx` | create | Tests |
| `components/cert-wizard/sim-rules-badge.tsx` | create | "✓ Las 3 reglas se cumplen" badge |
| `components/cert-wizard/sim-stat-cards.tsx` | create | 4 cards (Comercios, Órdenes, Retorno, Plazo) |
| `components/cert-wizard/sim-stat-cards.test.tsx` | create | Tests |
| `components/cert-wizard/sim-investor-breakdown.tsx` | create | Capital → No colocado → Efectivo → Intereses → Total |
| `components/cert-wizard/sim-investor-breakdown.test.tsx` | create | Tests |
| `components/cert-wizard/sim-concentration-bars.tsx` | create | Top 5 merchants with bars |
| `components/cert-wizard/sim-concentration-bars.test.tsx` | create | Tests |
| `components/cert-wizard/sim-maturity-timeline.tsx` | create | Horizontal timeline of due dates |
| `components/cert-wizard/sim-maturity-timeline.test.tsx` | create | Tests |
| `components/cert-wizard/sim-form.tsx` | create | Form column inputs + calc summary |
| `components/cert-wizard/sim-form.test.tsx` | create | Tests |
| `components/cert-wizard/step2-simulation.tsx` | create | 2-col layout composing form + preview panels |
| `components/cert-wizard/step2-simulation.test.tsx` | create | Tests |
| `components/cert-wizard/step3-confirm.tsx` | create | Summary + confirm mutation |
| `components/cert-wizard/step3-confirm.test.tsx` | create | Tests |
| `components/cert-wizard/new-cert-wizard.tsx` | create | Modal + reducer + step routing |
| `components/cert-wizard/new-cert-wizard.test.tsx` | create | Smoke integrated |
| `components/cert-wizard/new-cert-button.tsx` | create | Button gated by `certificate.simulate` permission |
| `components/cert-wizard/new-cert-button.test.tsx` | create | Tests |
| `components/stock/stock-page.tsx` | modify | Mount NewCertButton in PageHeader actions, render wizard when open |

**Total:** 33 new + 2 modified files (49 with tests).

**Manual operational tasks:**

| Action | Owner | When |
|---|---|---|
| Push branch + open PR | controller | Task 23 |
| Review + merge | user | After Task 23 |
| Verify Vercel deploy + visual smoke | user | Post-merge |

---

## Task 1: Branch + types (`investor.ts`, `certificate.ts`)

**Files:**
- Create: `lib/types/investor.ts`
- Create: `lib/types/certificate.ts`

- [ ] **Step 1: Create branch from main**

```bash
cd /Users/llam/dev/araguaney_front
git fetch origin --prune
git checkout main
git pull origin main
git checkout -b feat/slice-4-cert-wizard
```

- [ ] **Step 2: Create `lib/types/investor.ts`**

```ts
export type InvestorKind = 'juridica' | 'natural' | 'internal';
export type InvestorStatus = 'active' | 'inactive';

export interface InvestorSummary {
  id: string;
  legal_name: string;
  rif: string;
  kind: InvestorKind;
  status: InvestorStatus;
  email: string | null;
  phone: string | null;
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
  kind: 'juridica' | 'natural';
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
}
```

- [ ] **Step 3: Create `lib/types/certificate.ts`**

```ts
export type CertificateStatus = 'draft' | 'issued' | 'matured' | 'cancelled';
export type CertificateType = 'standard' | 'sweep';
export type CertificateTermDays = 14 | 42;

export interface Certificate {
  id: string;
  code: string;
  status: CertificateStatus;
  certificate_type: CertificateType;
  investor: { id: string; legal_name: string; rif: string };
  capital: string;
  rate: string;
  term_days: CertificateTermDays;
  issue_date: string;
  maturity_date: string;
  nominal_target: string;
  nominal_actual: string;
  investor_paid: string;
  investor_yield: string;
  num_orders: number;
  issued_at: string | null;
}

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
  investor: { id: string; legal_name: string; rif: string };
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

- [ ] **Step 4: Verify typecheck**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add lib/types/investor.ts lib/types/certificate.ts
git commit -m "$(cat <<'EOF'
feat(types): add Investor + Certificate + SimulationResult shapes

Hand-typed against /api/investors and /api/certificates responses
for the cert wizard. Pattern matches lib/types/order.ts (snake_case
matching back's wire format, Decimal-as-string).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `lib/format/percent.ts`

**Files:**
- Create: `lib/format/percent.ts`
- Create: `lib/format/percent.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { fmtPct } from './percent';

describe('fmtPct', () => {
  it('formats a fraction as percent with 1 decimal by default', () => {
    expect(fmtPct(0.13)).toBe('13.0%');
    expect(fmtPct(0.984833)).toBe('98.5%');
  });

  it('respects decimals override', () => {
    expect(fmtPct(0.984833, 4)).toBe('98.4833%');
    expect(fmtPct(0.13, 0)).toBe('13%');
  });

  it('handles 0 and 1', () => {
    expect(fmtPct(0)).toBe('0.0%');
    expect(fmtPct(1, 0)).toBe('100%');
  });

  it('accepts string inputs (Decimal-as-string)', () => {
    expect(fmtPct('0.0152')).toBe('1.5%');
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/format/percent.test.ts
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

```ts
export function fmtPct(value: number | string, decimals = 1): string {
  const n = typeof value === 'string' ? Number(value) : value;
  return `${(n * 100).toFixed(decimals)}%`;
}
```

- [ ] **Step 4: Confirm tests pass**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/format/percent.test.ts
```

Expected: 4/4.

- [ ] **Step 5: Verify suite**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

Expected: all clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add lib/format/percent.ts lib/format/percent.test.ts
git commit -m "$(cat <<'EOF'
feat(format): fmtPct helper

Used by Step 2 of the cert wizard to render rate (13.0%), price
(98.4833%), shortfall_pct, etc. Accepts both number and string
(Decimal-as-string from the back).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `lib/api/investors.ts`

**Files:**
- Create: `lib/api/investors.ts`
- Create: `lib/api/investors.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listInvestors, createInvestor } from './investors';

const mockApiFetch = vi.fn();
vi.mock('./client', () => ({
  apiFetch: (path: string, init?: RequestInit) => mockApiFetch(path, init),
  ApiError: class ApiError extends Error {},
}));

describe('listInvestors', () => {
  beforeEach(() => vi.clearAllMocks());

  it('GETs /api/investors with no params', async () => {
    mockApiFetch.mockResolvedValueOnce({ data: [], total: 0, limit: 50, offset: 0 });
    await listInvestors();
    expect(mockApiFetch).toHaveBeenCalledWith('/api/investors', { method: 'GET' });
  });

  it('appends filters to the query string', async () => {
    mockApiFetch.mockResolvedValueOnce({ data: [], total: 0, limit: 50, offset: 0 });
    await listInvestors({ q: 'alpha', kind: 'juridica', status: 'active', limit: 50, offset: 0 });
    const path = mockApiFetch.mock.calls[0][0] as string;
    expect(path).toContain('q=alpha');
    expect(path).toContain('kind=juridica');
    expect(path).toContain('status=active');
    expect(path).toContain('limit=50');
  });
});

describe('createInvestor', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POSTs the body as JSON to /api/investors', async () => {
    mockApiFetch.mockResolvedValueOnce({
      id: 'inv-1',
      legal_name: 'Alpha',
      rif: 'J-1',
      kind: 'juridica',
      status: 'active',
      email: null,
      phone: null,
    });
    const result = await createInvestor({
      legal_name: 'Alpha',
      rif: 'J-1',
      kind: 'juridica',
    });
    expect(result.id).toBe('inv-1');
    const [path, init] = mockApiFetch.mock.calls[0];
    expect(path).toBe('/api/investors');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      legal_name: 'Alpha',
      rif: 'J-1',
      kind: 'juridica',
    });
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/api/investors.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
'use server';

import { apiFetch } from './client';
import { ApiError } from './error';
import type {
  InvestorCreate,
  InvestorSummary,
  InvestorsListResponse,
} from '@/lib/types/investor';

function rethrowWithMessage(err: unknown): never {
  if (err instanceof ApiError) {
    const body = err.body as { message?: string } | null;
    throw new Error(body?.message ?? `Error del servidor (${err.status})`);
  }
  throw err;
}

export interface ListInvestorsQuery {
  limit?: number;
  offset?: number;
  q?: string;
  kind?: 'juridica' | 'natural' | 'internal';
  status?: 'active' | 'inactive';
  sort?: 'name_asc' | 'name_desc' | 'created_desc';
}

export async function listInvestors(
  query: ListInvestorsQuery = {},
): Promise<InvestorsListResponse> {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.offset !== undefined) params.set('offset', String(query.offset));
  if (query.q) params.set('q', query.q);
  if (query.kind) params.set('kind', query.kind);
  if (query.status) params.set('status', query.status);
  if (query.sort) params.set('sort', query.sort);
  const qs = params.toString();
  try {
    return await apiFetch<InvestorsListResponse>(`/api/investors${qs ? '?' + qs : ''}`, {
      method: 'GET',
    });
  } catch (err) {
    rethrowWithMessage(err);
  }
}

export async function createInvestor(body: InvestorCreate): Promise<InvestorSummary> {
  try {
    return await apiFetch<InvestorSummary>('/api/investors', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  } catch (err) {
    rethrowWithMessage(err);
  }
}
```

- [ ] **Step 4: Pass + verify suite**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/api/investors.test.ts
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

Expected: 3/3 file tests + full suite green.

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add lib/api/investors.ts lib/api/investors.test.ts
git commit -m "$(cat <<'EOF'
feat(api): listInvestors + createInvestor Server Actions

Wraps GET /api/investors and POST /api/investors. Step 1 of the cert
wizard consumes both. Same rethrowWithMessage pattern as orders/batches.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Extend `lib/api/certificates.ts`

**Files:**
- Modify: `lib/api/certificates.ts` (add 2 functions)
- Modify: `lib/api/certificates.test.ts` (add tests)

- [ ] **Step 1: Failing test (append to existing test file)**

Add to `/Users/llam/dev/araguaney_front/lib/api/certificates.test.ts` AFTER the existing `describe('countCertificatesIssued', ...)` block:

```ts
import { simulateCertificate, issueCertificate } from './certificates';

describe('simulateCertificate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POSTs body as JSON to /api/certificates/simulate', async () => {
    mockApiFetch.mockResolvedValueOnce({ payload_hash: 'abc' });
    await simulateCertificate({
      investor_id: 'inv-1',
      capital: 100000,
      rate: 0.13,
      term_days: 42,
      issue_date: '2026-05-10',
    });
    const [path, init] = mockApiFetch.mock.calls[0];
    expect(path).toBe('/api/certificates/simulate');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      investor_id: 'inv-1',
      capital: 100000,
      rate: 0.13,
      term_days: 42,
      issue_date: '2026-05-10',
    });
  });
});

describe('issueCertificate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POSTs simulate body + order_ids + payload_hash to /api/certificates', async () => {
    mockApiFetch.mockResolvedValueOnce({ id: 'c-1', code: 'C0001A' });
    await issueCertificate({
      investor_id: 'inv-1',
      capital: 100000,
      rate: 0.13,
      term_days: 42,
      issue_date: '2026-05-10',
      order_ids: ['o-1', 'o-2'],
      expected_payload_hash: 'abc123',
    });
    const init = mockApiFetch.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.order_ids).toEqual(['o-1', 'o-2']);
    expect(body.expected_payload_hash).toBe('abc123');
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/api/certificates.test.ts
```

Expected: FAIL — `simulateCertificate` / `issueCertificate` not exported.

- [ ] **Step 3: Implement** — append to `/Users/llam/dev/araguaney_front/lib/api/certificates.ts`:

```ts
import type { Certificate, CertificateTermDays, SimulationResult } from '@/lib/types/certificate';

export interface SimulateCertificateBody {
  investor_id: string;
  capital: number;
  rate: number;
  term_days: CertificateTermDays;
  issue_date: string;
}

export interface IssueCertificateBody extends SimulateCertificateBody {
  order_ids: string[];
  expected_payload_hash: string;
}

export async function simulateCertificate(
  body: SimulateCertificateBody,
): Promise<SimulationResult> {
  try {
    return await apiFetch<SimulationResult>('/api/certificates/simulate', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  } catch (err) {
    rethrowWithMessage(err);
  }
}

export async function issueCertificate(body: IssueCertificateBody): Promise<Certificate> {
  try {
    return await apiFetch<Certificate>('/api/certificates', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  } catch (err) {
    rethrowWithMessage(err);
  }
}
```

- [ ] **Step 4: Pass + verify suite**

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
feat(api): simulateCertificate + issueCertificate

Step 2 of the wizard simulates the pool. Step 3 commits the issue.
Same Server Action pattern as the rest. Body shapes match back's
SimulateBase + IssueExtension.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `wizard-state.ts` (reducer)

**Files:**
- Create: `components/cert-wizard/wizard-state.ts`
- Create: `components/cert-wizard/wizard-state.test.ts`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/components/cert-wizard/wizard-state.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { wizardReducer, initialWizardState, type WizardState } from './wizard-state';

const inv = { id: 'inv-1', legal_name: 'Alpha', rif: 'J-1' };

describe('wizardReducer', () => {
  it('starts at step 1 with no investor + no simulation', () => {
    expect(initialWizardState.step).toBe(1);
    expect(initialWizardState.investor).toBeNull();
    expect(initialWizardState.simulation).toBeNull();
    expect(initialWizardState.params.term_days).toBe(42);
  });

  it('SET_INVESTOR sets investor and advances to step 2', () => {
    const next = wizardReducer(initialWizardState, { type: 'SET_INVESTOR', investor: inv });
    expect(next.investor).toEqual(inv);
    expect(next.step).toBe(2);
  });

  it('SET_PARAMS merges partial params + clears simulation', () => {
    const withSim: WizardState = {
      ...initialWizardState,
      step: 2,
      simulation: { payload_hash: 'x' } as never,
    };
    const next = wizardReducer(withSim, { type: 'SET_PARAMS', params: { capital: '50000' } });
    expect(next.params.capital).toBe('50000');
    expect(next.params.term_days).toBe(42);
    expect(next.simulation).toBeNull();
  });

  it('SET_SIMULATION stores result and clears poolChangedWarning', () => {
    const next = wizardReducer(
      { ...initialWizardState, poolChangedWarning: true },
      { type: 'SET_SIMULATION', simulation: { payload_hash: 'h' } as never },
    );
    expect(next.simulation).toEqual({ payload_hash: 'h' });
    expect(next.poolChangedWarning).toBe(false);
  });

  it('GO_TO_STEP changes step', () => {
    const s2: WizardState = { ...initialWizardState, investor: inv, step: 2 };
    expect(wizardReducer(s2, { type: 'GO_TO_STEP', step: 3 }).step).toBe(3);
    expect(wizardReducer(s2, { type: 'GO_TO_STEP', step: 1 }).step).toBe(1);
  });

  it('POOL_CHANGED sets warning + drops simulation + returns to step 2', () => {
    const s3: WizardState = {
      ...initialWizardState,
      step: 3,
      investor: inv,
      simulation: { payload_hash: 'x' } as never,
    };
    const next = wizardReducer(s3, { type: 'POOL_CHANGED' });
    expect(next.step).toBe(2);
    expect(next.poolChangedWarning).toBe(true);
    expect(next.simulation).toBeNull();
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
mkdir -p components/cert-wizard
pnpm test components/cert-wizard/wizard-state.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/cert-wizard/wizard-state.ts`:

```ts
import type { SimulationResult, CertificateTermDays } from '@/lib/types/certificate';

export interface WizardState {
  step: 1 | 2 | 3;
  investor: { id: string; legal_name: string; rif: string } | null;
  params: {
    capital: string;
    rate: string;
    term_days: CertificateTermDays;
    issue_date: string;
  };
  simulation: SimulationResult | null;
  poolChangedWarning: boolean;
}

function todayIso(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const initialWizardState: WizardState = {
  step: 1,
  investor: null,
  params: {
    capital: '100000',
    rate: '0.13',
    term_days: 42,
    issue_date: todayIso(),
  },
  simulation: null,
  poolChangedWarning: false,
};

export type WizardAction =
  | { type: 'SET_INVESTOR'; investor: WizardState['investor'] }
  | { type: 'SET_PARAMS'; params: Partial<WizardState['params']> }
  | { type: 'SET_SIMULATION'; simulation: SimulationResult }
  | { type: 'GO_TO_STEP'; step: 1 | 2 | 3 }
  | { type: 'POOL_CHANGED' };

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'SET_INVESTOR':
      return { ...state, investor: action.investor, step: 2 };
    case 'SET_PARAMS':
      return {
        ...state,
        params: { ...state.params, ...action.params },
        simulation: null,
      };
    case 'SET_SIMULATION':
      return { ...state, simulation: action.simulation, poolChangedWarning: false };
    case 'GO_TO_STEP':
      return { ...state, step: action.step };
    case 'POOL_CHANGED':
      return { ...state, step: 2, simulation: null, poolChangedWarning: true };
  }
}
```

- [ ] **Step 4: Pass + verify suite**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cert-wizard/wizard-state.test.ts
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

Expected: 6/6 + suite green.

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/cert-wizard/wizard-state.ts components/cert-wizard/wizard-state.test.ts
git commit -m "$(cat <<'EOF'
feat(cert-wizard): wizardReducer + initial state

Pure reducer for the 3-step wizard state machine. SET_INVESTOR
auto-advances to Step 2; SET_PARAMS clears stale simulation;
POOL_CHANGED handles the 409 race by returning to Step 2 with a
warning flag.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `<StepIndicator>`

**Files:**
- Create: `components/cert-wizard/step-indicator.tsx`
- Create: `components/cert-wizard/step-indicator.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StepIndicator } from './step-indicator';

describe('<StepIndicator />', () => {
  it('marks step 1 active when current=1', () => {
    render(<StepIndicator current={1} />);
    expect(screen.getByTestId('step-1')).toHaveAttribute('data-state', 'active');
    expect(screen.getByTestId('step-2')).toHaveAttribute('data-state', 'pending');
    expect(screen.getByTestId('step-3')).toHaveAttribute('data-state', 'pending');
  });

  it('marks steps 1 and 2 done when current=3', () => {
    render(<StepIndicator current={3} />);
    expect(screen.getByTestId('step-1')).toHaveAttribute('data-state', 'done');
    expect(screen.getByTestId('step-2')).toHaveAttribute('data-state', 'done');
    expect(screen.getByTestId('step-3')).toHaveAttribute('data-state', 'active');
  });

  it('renders Spanish step labels', () => {
    render(<StepIndicator current={1} />);
    expect(screen.getByText('Datos del inversor')).toBeInTheDocument();
    expect(screen.getByText('Simulación del pool')).toBeInTheDocument();
    expect(screen.getByText('Emisión y firma')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cert-wizard/step-indicator.test.tsx
```

- [ ] **Step 3: Implement**

```tsx
const STEPS: Array<{ n: 1 | 2 | 3; label: string }> = [
  { n: 1, label: 'Datos del inversor' },
  { n: 2, label: 'Simulación del pool' },
  { n: 3, label: 'Emisión y firma' },
];

function stateFor(stepN: 1 | 2 | 3, current: 1 | 2 | 3): 'done' | 'active' | 'pending' {
  if (stepN < current) return 'done';
  if (stepN === current) return 'active';
  return 'pending';
}

export function StepIndicator({ current }: { current: 1 | 2 | 3 }) {
  return (
    <div className="border-border-subtle bg-subtle flex items-center gap-3 border-b px-7 py-3">
      {STEPS.map((s, i) => {
        const state = stateFor(s.n, current);
        return (
          <div key={s.n} className="flex items-center gap-3">
            <div data-testid={`step-${s.n}`} data-state={state} className="flex items-center gap-2">
              <Bullet state={state} n={s.n} />
              <span
                className={
                  'text-[11px] font-medium ' +
                  (state === 'done'
                    ? 'text-green-text'
                    : state === 'active'
                      ? 'text-foreground'
                      : 'text-text-3')
                }
              >
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && <span className="text-text-3 text-[11px]">→</span>}
          </div>
        );
      })}
    </div>
  );
}

function Bullet({ state, n }: { state: 'done' | 'active' | 'pending'; n: number }) {
  if (state === 'done') {
    return (
      <span className="bg-green-bg text-green-text inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold">
        ✓
      </span>
    );
  }
  const cls =
    state === 'active'
      ? 'bg-foreground text-background'
      : 'bg-neutral-bg text-text-3';
  return (
    <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold ${cls}`}>
      {n}
    </span>
  );
}
```

- [ ] **Step 4: Pass + verify suite**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cert-wizard/step-indicator.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/cert-wizard/step-indicator.tsx components/cert-wizard/step-indicator.test.tsx
git commit -m "$(cat <<'EOF'
feat(cert-wizard): StepIndicator component

Visual 1·2·3 with done/active/pending states matching the mockup
(443031f2). Uses theme tokens (green-bg/green-text for done, etc.).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `<WizardFooter>`

**Files:**
- Create: `components/cert-wizard/wizard-footer.tsx`
- Create: `components/cert-wizard/wizard-footer.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WizardFooter } from './wizard-footer';

describe('<WizardFooter />', () => {
  it('Step 1: shows Cancel + Continuar (disabled when canContinue=false)', () => {
    render(
      <WizardFooter
        step={1}
        canContinue={false}
        onCancel={vi.fn()}
        onBack={vi.fn()}
        onContinue={vi.fn()}
        onRecalculate={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continuar/i })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /atr[aá]s/i })).not.toBeInTheDocument();
  });

  it('Step 2 with simulation: shows Recalcular, Atrás, Cancelar, Emitir', () => {
    render(
      <WizardFooter
        step={2}
        hasSimulation={true}
        canContinue={true}
        onCancel={vi.fn()}
        onBack={vi.fn()}
        onContinue={vi.fn()}
        onRecalculate={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /recalcular/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /atr[aá]s/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /emitir/i })).toBeInTheDocument();
  });

  it('Step 2 without simulation: Emitir is disabled', () => {
    render(
      <WizardFooter
        step={2}
        hasSimulation={false}
        canContinue={false}
        onCancel={vi.fn()}
        onBack={vi.fn()}
        onContinue={vi.fn()}
        onRecalculate={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /emitir/i })).toBeDisabled();
  });

  it('Step 3: Confirmar emisión button calls onConfirm', () => {
    const onConfirm = vi.fn();
    render(
      <WizardFooter
        step={3}
        canContinue={true}
        onCancel={vi.fn()}
        onBack={vi.fn()}
        onContinue={vi.fn()}
        onRecalculate={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /confirmar emisi[oó]n/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('disables all action buttons when busy=true', () => {
    render(
      <WizardFooter
        step={3}
        canContinue={true}
        busy={true}
        onCancel={vi.fn()}
        onBack={vi.fn()}
        onContinue={vi.fn()}
        onRecalculate={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /confirmar emisi[oó]n/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cert-wizard/wizard-footer.test.tsx
```

- [ ] **Step 3: Implement**

```tsx
interface Props {
  step: 1 | 2 | 3;
  hasSimulation?: boolean;
  canContinue: boolean;
  busy?: boolean;
  onCancel: () => void;
  onBack: () => void;
  onContinue: () => void;
  onRecalculate: () => void;
  onConfirm: () => void;
}

export function WizardFooter({
  step,
  hasSimulation = false,
  canContinue,
  busy = false,
  onCancel,
  onBack,
  onContinue,
  onRecalculate,
  onConfirm,
}: Props) {
  return (
    <div className="border-border-subtle bg-card flex items-center justify-end gap-2 border-t px-7 py-4">
      {step === 1 && (
        <>
          <Btn onClick={onCancel} variant="ghost" disabled={busy}>
            Cancelar
          </Btn>
          <Btn onClick={onContinue} variant="primary" disabled={!canContinue || busy}>
            Continuar →
          </Btn>
        </>
      )}
      {step === 2 && (
        <>
          <Btn onClick={onCancel} variant="ghost" disabled={busy}>
            Cancelar
          </Btn>
          <Btn onClick={onBack} variant="ghost" disabled={busy}>
            ← Atrás
          </Btn>
          <Btn onClick={onRecalculate} variant="ghost" disabled={busy}>
            Recalcular
          </Btn>
          <Btn onClick={onConfirm} variant="primary" disabled={!hasSimulation || busy}>
            Emitir certificado →
          </Btn>
        </>
      )}
      {step === 3 && (
        <>
          <Btn onClick={onCancel} variant="ghost" disabled={busy}>
            Cancelar
          </Btn>
          <Btn onClick={onBack} variant="ghost" disabled={busy}>
            ← Atrás
          </Btn>
          <Btn onClick={onConfirm} variant="primary" disabled={!canContinue || busy}>
            {busy ? 'Emitiendo…' : 'Confirmar emisión'}
          </Btn>
        </>
      )}
    </div>
  );
}

function Btn({
  children,
  onClick,
  variant,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant: 'primary' | 'ghost';
  disabled?: boolean;
}) {
  const cls =
    variant === 'primary'
      ? 'bg-foreground text-background hover:opacity-90'
      : 'border-border-subtle bg-card text-text-2 hover:bg-subtle border';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md px-3 py-1.5 text-[12px] font-medium disabled:opacity-40 ${cls}`}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cert-wizard/wizard-footer.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/cert-wizard/wizard-footer.tsx components/cert-wizard/wizard-footer.test.tsx
git commit -m "$(cat <<'EOF'
feat(cert-wizard): WizardFooter component

Renders contextual action buttons per step. Disabled states for
canContinue/hasSimulation/busy match the design (mockup 443031f2)
plus the Step 3 emit-loading state.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `<InvestorList>`

**Files:**
- Create: `components/cert-wizard/investor-list.tsx`
- Create: `components/cert-wizard/investor-list.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithQuery } from '@/test/helpers/tanstack';
import { InvestorList } from './investor-list';

const { mockListInvestors } = vi.hoisted(() => ({ mockListInvestors: vi.fn() }));

vi.mock('@/lib/api/investors', () => ({
  listInvestors: (...a: unknown[]) => mockListInvestors(...a),
}));

const mkInvestor = (over = {}) => ({
  id: 'inv-1',
  legal_name: 'Inversora Alpha, C.A.',
  rif: 'J-12345678-9',
  kind: 'juridica' as const,
  status: 'active' as const,
  email: null,
  phone: null,
  ...over,
});

describe('<InvestorList />', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows loading state initially', () => {
    mockListInvestors.mockImplementation(() => new Promise(() => {}));
    renderWithQuery(<InvestorList onSelect={vi.fn()} />);
    expect(screen.getByText(/cargando/i)).toBeInTheDocument();
  });

  it('renders investors after data arrives', async () => {
    mockListInvestors.mockResolvedValueOnce({
      data: [mkInvestor(), mkInvestor({ id: 'inv-2', legal_name: 'Beta' })],
      total: 2,
      limit: 50,
      offset: 0,
    });
    renderWithQuery(<InvestorList onSelect={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText('Inversora Alpha, C.A.')).toBeInTheDocument(),
    );
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('shows empty state when no investors', async () => {
    mockListInvestors.mockResolvedValueOnce({ data: [], total: 0, limit: 50, offset: 0 });
    renderWithQuery(<InvestorList onSelect={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText(/no hay inversores/i)).toBeInTheDocument(),
    );
  });

  it('clicking a row calls onSelect with the investor', async () => {
    const onSelect = vi.fn();
    mockListInvestors.mockResolvedValueOnce({
      data: [mkInvestor()],
      total: 1,
      limit: 50,
      offset: 0,
    });
    renderWithQuery(<InvestorList onSelect={onSelect} />);
    await waitFor(() =>
      expect(screen.getByText('Inversora Alpha, C.A.')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText('Inversora Alpha, C.A.'));
    expect(onSelect).toHaveBeenCalledWith(mkInvestor());
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cert-wizard/investor-list.test.tsx
```

- [ ] **Step 3: Implement**

```tsx
'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listInvestors } from '@/lib/api/investors';
import type { InvestorSummary } from '@/lib/types/investor';

interface Props {
  onSelect: (investor: InvestorSummary) => void;
}

export function InvestorList({ onSelect }: Props) {
  const [q, setQ] = useState('');
  const { data, isLoading, isError } = useQuery({
    queryKey: ['investors', { q, kind: 'juridica', status: 'active' }],
    queryFn: () =>
      listInvestors({ q: q || undefined, kind: 'juridica', status: 'active', limit: 50 }),
    staleTime: 60 * 1000,
  });

  return (
    <div className="flex flex-col gap-3">
      <input
        type="search"
        placeholder="🔎 Buscar por razón social o RIF"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="border-border-subtle bg-card rounded-md border px-3 py-2 text-[12px]"
      />
      {isLoading && <div className="text-text-3 py-12 text-center text-sm">Cargando…</div>}
      {isError && (
        <div className="text-text-3 py-12 text-center text-sm">
          No se pudieron cargar los inversores.
        </div>
      )}
      {data && data.data.length === 0 && (
        <div className="text-text-3 py-12 text-center text-sm">
          No hay inversores que coincidan.
        </div>
      )}
      {data && data.data.length > 0 && (
        <ul className="border-border-subtle divide-border-subtle bg-card divide-y rounded-md border">
          {data.data.map((inv) => (
            <li key={inv.id}>
              <button
                type="button"
                onClick={() => onSelect(inv)}
                className="hover:bg-subtle flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors"
              >
                <div>
                  <div className="text-[13px] font-medium">{inv.legal_name}</div>
                  <div className="text-text-3 mt-0.5 font-mono text-[11px]">{inv.rif}</div>
                </div>
                <div className="text-text-3 text-[11px]">{inv.kind}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cert-wizard/investor-list.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/cert-wizard/investor-list.tsx components/cert-wizard/investor-list.test.tsx
git commit -m "$(cat <<'EOF'
feat(cert-wizard): InvestorList component

Search + paginated list of existing juridica/active investors. Step 1
of the wizard. Click → onSelect(investor). Filtra solo juridica para
excluir el reservado 'internal' (sweep).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `<InvestorCreateForm>`

**Files:**
- Create: `components/cert-wizard/investor-create-form.tsx`
- Create: `components/cert-wizard/investor-create-form.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from '@/test/helpers/tanstack';
import { InvestorCreateForm } from './investor-create-form';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('@/lib/api/investors', () => ({
  createInvestor: (...a: unknown[]) => mockCreate(...a),
}));

describe('<InvestorCreateForm />', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders all fields with juridica selected by default', () => {
    renderWithQuery(<InvestorCreateForm onCreated={vi.fn()} />);
    expect(screen.getByLabelText(/razón social/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^rif/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/tel[eé]fono/i)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /jur[ií]dica/i })).toBeChecked();
  });

  it('disables submit when required fields are empty', () => {
    renderWithQuery(<InvestorCreateForm onCreated={vi.fn()} />);
    expect(screen.getByRole('button', { name: /crear inversor/i })).toBeDisabled();
  });

  it('submits with the entered values and calls onCreated', async () => {
    mockCreate.mockResolvedValueOnce({
      id: 'inv-99',
      legal_name: 'Inv X',
      rif: 'J-1',
      kind: 'juridica',
      status: 'active',
      email: null,
      phone: null,
    });
    const onCreated = vi.fn();
    renderWithQuery(<InvestorCreateForm onCreated={onCreated} />);
    fireEvent.change(screen.getByLabelText(/razón social/i), { target: { value: 'Inv X' } });
    fireEvent.change(screen.getByLabelText(/^rif/i), { target: { value: 'J-1' } });
    fireEvent.click(screen.getByRole('button', { name: /crear inversor/i }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(mockCreate.mock.calls[0][0]).toMatchObject({
      legal_name: 'Inv X',
      rif: 'J-1',
      kind: 'juridica',
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });

  it('shows the back error message inline on failure', async () => {
    mockCreate.mockRejectedValueOnce(new Error('RIF duplicado'));
    renderWithQuery(<InvestorCreateForm onCreated={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/razón social/i), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText(/^rif/i), { target: { value: 'J-1' } });
    fireEvent.click(screen.getByRole('button', { name: /crear inversor/i }));
    await waitFor(() => expect(screen.getByText('RIF duplicado')).toBeInTheDocument());
  });

  it('toggles to natural when clicking that radio', () => {
    renderWithQuery(<InvestorCreateForm onCreated={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: /natural/i }));
    expect(screen.getByRole('radio', { name: /natural/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /jur[ií]dica/i })).not.toBeChecked();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cert-wizard/investor-create-form.test.tsx
```

- [ ] **Step 3: Implement**

```tsx
'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createInvestor } from '@/lib/api/investors';
import type { InvestorSummary } from '@/lib/types/investor';

interface Props {
  onCreated: (investor: InvestorSummary) => void;
}

type Kind = 'juridica' | 'natural';

export function InvestorCreateForm({ onCreated }: Props) {
  const [legalName, setLegalName] = useState('');
  const [rif, setRif] = useState('');
  const [kind, setKind] = useState<Kind>('juridica');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const mut = useMutation({
    mutationFn: createInvestor,
    onSuccess: (inv) => {
      qc.invalidateQueries({ queryKey: ['investors'] });
      onCreated(inv);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'No se pudo crear el inversor');
    },
  });

  const canSubmit = legalName.trim().length > 0 && rif.trim().length > 0 && !mut.isPending;

  function handleSubmit() {
    setError(null);
    mut.mutate({
      legal_name: legalName.trim(),
      rif: rif.trim(),
      kind,
      email: email.trim() || null,
      phone: phone.trim() || null,
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <Field label="Razón social *" id="legal_name">
        <input
          id="legal_name"
          type="text"
          value={legalName}
          onChange={(e) => setLegalName(e.target.value)}
          maxLength={255}
          className="border-border-subtle bg-card rounded-md border px-3 py-2 text-[12px]"
        />
      </Field>
      <Field label="RIF *" id="rif">
        <input
          id="rif"
          type="text"
          value={rif}
          onChange={(e) => setRif(e.target.value)}
          maxLength={50}
          className="border-border-subtle bg-card rounded-md border px-3 py-2 font-mono text-[12px]"
        />
      </Field>
      <fieldset className="flex items-center gap-4">
        <legend className="text-text-3 mb-1 text-[11px]">Tipo</legend>
        <label className="flex items-center gap-2 text-[12px]">
          <input
            type="radio"
            name="kind"
            checked={kind === 'juridica'}
            onChange={() => setKind('juridica')}
          />
          Jurídica
        </label>
        <label className="flex items-center gap-2 text-[12px]">
          <input
            type="radio"
            name="kind"
            checked={kind === 'natural'}
            onChange={() => setKind('natural')}
          />
          Natural
        </label>
      </fieldset>
      <Field label="Email" id="email">
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          maxLength={255}
          className="border-border-subtle bg-card rounded-md border px-3 py-2 text-[12px]"
        />
      </Field>
      <Field label="Teléfono" id="phone">
        <input
          id="phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          maxLength={50}
          className="border-border-subtle bg-card rounded-md border px-3 py-2 text-[12px]"
        />
      </Field>
      {error && (
        <div className="bg-warn-bg text-warn-text rounded-md px-3 py-2 text-[12px]">{error}</div>
      )}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="bg-foreground text-background mt-2 self-start rounded-md px-4 py-2 text-[12px] font-medium disabled:opacity-40"
      >
        {mut.isPending ? 'Creando…' : 'Crear inversor'}
      </button>
    </div>
  );
}

function Field({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1">
      <span className="text-text-3 text-[11px]">{label}</span>
      {children}
    </label>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cert-wizard/investor-create-form.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/cert-wizard/investor-create-form.tsx components/cert-wizard/investor-create-form.test.tsx
git commit -m "$(cat <<'EOF'
feat(cert-wizard): InvestorCreateForm component

Mini-form for creating a juridica/natural investor inline in Step 1.
On success: invalidate investors query + onCreated callback. Surfaces
back's error message inline (e.g. RIF duplicado).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: `<Step1Investor>` (composes 8 + 9 with tabs)

**Files:**
- Create: `components/cert-wizard/step1-investor.tsx`
- Create: `components/cert-wizard/step1-investor.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from '@/test/helpers/tanstack';
import { Step1Investor } from './step1-investor';

const { mockListInvestors, mockCreate } = vi.hoisted(() => ({
  mockListInvestors: vi.fn(),
  mockCreate: vi.fn(),
}));

vi.mock('@/lib/api/investors', () => ({
  listInvestors: (...a: unknown[]) => mockListInvestors(...a),
  createInvestor: (...a: unknown[]) => mockCreate(...a),
}));

describe('<Step1Investor />', () => {
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
      limit: 50,
      offset: 0,
    });
  });

  it('starts with Existente tab active', () => {
    renderWithQuery(<Step1Investor onSelect={vi.fn()} />);
    expect(screen.getByRole('tab', { name: /existente/i })).toHaveAttribute(
      'data-state',
      'active',
    );
  });

  it('switching to Nuevo tab shows the create form', () => {
    renderWithQuery(<Step1Investor onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: /nuevo/i }));
    expect(screen.getByLabelText(/razón social/i)).toBeInTheDocument();
  });

  it('selecting an existing investor calls onSelect', async () => {
    const onSelect = vi.fn();
    renderWithQuery(<Step1Investor onSelect={onSelect} />);
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Alpha'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'inv-1' }));
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cert-wizard/step1-investor.test.tsx
```

- [ ] **Step 3: Implement**

```tsx
'use client';

import { useState } from 'react';
import { InvestorList } from './investor-list';
import { InvestorCreateForm } from './investor-create-form';
import type { InvestorSummary } from '@/lib/types/investor';

interface Props {
  onSelect: (investor: InvestorSummary) => void;
}

type Tab = 'existente' | 'nuevo';

export function Step1Investor({ onSelect }: Props) {
  const [tab, setTab] = useState<Tab>('existente');

  return (
    <div className="flex flex-col gap-4 px-7 py-6">
      <div className="border-border-subtle flex items-center gap-1 rounded-md border p-1 self-start">
        <TabBtn current={tab} value="existente" onClick={setTab}>
          Existente
        </TabBtn>
        <TabBtn current={tab} value="nuevo" onClick={setTab}>
          Nuevo
        </TabBtn>
      </div>
      {tab === 'existente' ? (
        <InvestorList onSelect={onSelect} />
      ) : (
        <InvestorCreateForm onCreated={onSelect} />
      )}
    </div>
  );
}

function TabBtn({
  current,
  value,
  onClick,
  children,
}: {
  current: Tab;
  value: Tab;
  onClick: (t: Tab) => void;
  children: React.ReactNode;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      role="tab"
      data-state={active ? 'active' : 'inactive'}
      onClick={() => onClick(value)}
      className={
        'rounded px-3 py-1 text-[12px] font-medium transition-colors ' +
        (active ? 'bg-foreground text-background' : 'text-text-2 hover:bg-subtle')
      }
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cert-wizard/step1-investor.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/cert-wizard/step1-investor.tsx components/cert-wizard/step1-investor.test.tsx
git commit -m "$(cat <<'EOF'
feat(cert-wizard): Step1Investor composition

Tabs Existente/Nuevo mounting InvestorList and InvestorCreateForm.
Both branches converge on onSelect — wizard treats them identically.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: `<SimRulesBadge>` (no test file, trivial component)

**Files:**
- Create: `components/cert-wizard/sim-rules-badge.tsx`

- [ ] **Step 1: Implement**

```tsx
import { Pill } from '@/components/ui/pill';

export function SimRulesBadge() {
  return <Pill variant="success">✓ Las 3 reglas se cumplen</Pill>;
}
```

- [ ] **Step 2: Verify suite**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 3: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/cert-wizard/sim-rules-badge.tsx
git commit -m "$(cat <<'EOF'
feat(cert-wizard): SimRulesBadge

Trivial wrapper around Pill — if simulate returned successfully,
the 3 product rules (maturity boundary, indivisibility, round-down)
are guaranteed to hold; just label it.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: `<SimStatCards>`

**Files:**
- Create: `components/cert-wizard/sim-stat-cards.tsx`
- Create: `components/cert-wizard/sim-stat-cards.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SimStatCards } from './sim-stat-cards';

const fakeSim = {
  total_distinct_merchants: 71,
  selected_orders: new Array(343).fill({}),
  nominal_actual: '101540.0000',
  installment_plazo_days: { min: 7, max: 42 },
} as unknown as Parameters<typeof SimStatCards>[0]['simulation'];

describe('<SimStatCards />', () => {
  it('renders 4 cards with formatted values', () => {
    render(<SimStatCards simulation={fakeSim} />);
    expect(screen.getByText('71')).toBeInTheDocument();
    expect(screen.getByText('343')).toBeInTheDocument();
    expect(screen.getByText('$101,540.00')).toBeInTheDocument();
    expect(screen.getByText('7—42d')).toBeInTheDocument();
  });

  it('shows total_eligible_merchants in the COMERCIOS sub when provided', () => {
    const sim = { ...fakeSim, total_eligible_merchants: 100 } as never;
    render(<SimStatCards simulation={sim} />);
    expect(screen.getByText(/100 elegibles/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cert-wizard/sim-stat-cards.test.tsx
```

- [ ] **Step 3: Implement**

```tsx
import { fmtMoney2 } from '@/lib/format/money';
import type { SimulationResult } from '@/lib/types/certificate';

interface Props {
  simulation: SimulationResult;
}

export function SimStatCards({ simulation }: Props) {
  const numOrders = simulation.selected_orders.length;
  const eligibleSub =
    typeof simulation.total_eligible_merchants === 'number'
      ? `${simulation.total_eligible_merchants} elegibles`
      : 'distintos RIF';
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <Card label="Comercios" value={String(simulation.total_distinct_merchants)} sub={eligibleSub} />
      <Card label="Órdenes" value={String(numOrders)} sub="empaquetadas" />
      <Card
        label="Retorno al vencimiento"
        value={fmtMoney2(Number(simulation.nominal_actual))}
        sub="nominal actual"
      />
      <Card
        label="Plazo cuotas"
        value={`${simulation.installment_plazo_days.min}—${simulation.installment_plazo_days.max}d`}
        sub="dentro del límite"
      />
    </div>
  );
}

function Card({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-card border-border-subtle rounded-lg border p-3">
      <div className="text-text-3 text-[10px] uppercase tracking-wide">{label}</div>
      <div className="mt-1 text-[16px] font-semibold tabular-nums tracking-[-0.3px]">{value}</div>
      <div className="text-text-3 mt-0.5 text-[10px]">{sub}</div>
    </div>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cert-wizard/sim-stat-cards.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/cert-wizard/sim-stat-cards.tsx components/cert-wizard/sim-stat-cards.test.tsx
git commit -m "$(cat <<'EOF'
feat(cert-wizard): SimStatCards (4 cards)

Comercios · Órdenes · Retorno al vencimiento · Plazo cuotas. Pulled
from SimulationResult fields. Same Card visual as StockStatsBanner.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: `<SimInvestorBreakdown>`

**Files:**
- Create: `components/cert-wizard/sim-investor-breakdown.tsx`
- Create: `components/cert-wizard/sim-investor-breakdown.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SimInvestorBreakdown } from './sim-investor-breakdown';

const sim = {
  capital: '100000.0000',
  investor_returned: '0.5900',
  investor_paid: '99999.4100',
  investor_yield: '1540.5900',
  nominal_actual: '101540.0000',
  maturity_date: '2026-06-08',
} as unknown as Parameters<typeof SimInvestorBreakdown>[0]['simulation'];

describe('<SimInvestorBreakdown />', () => {
  it('renders capital, returned, paid, yield, total with formatted amounts', () => {
    render(<SimInvestorBreakdown simulation={sim} />);
    expect(screen.getByText('$100,000.00')).toBeInTheDocument();
    expect(screen.getByText(/-\$0\.59/)).toBeInTheDocument();
    expect(screen.getByText('$99,999.41')).toBeInTheDocument();
    expect(screen.getByText(/\+\$1,540\.59/)).toBeInTheDocument();
    expect(screen.getByText('$101,540.00')).toBeInTheDocument();
  });

  it('displays the maturity date in the total row label', () => {
    render(<SimInvestorBreakdown simulation={sim} />);
    expect(screen.getByText(/total a recibir.*08\/06\/2026/i)).toBeInTheDocument();
  });

  it('handles a zero shortfall (no negative returned)', () => {
    const exact = { ...sim, investor_returned: '0.0000' } as never;
    render(<SimInvestorBreakdown simulation={exact} />);
    expect(screen.getByText('-$0.00')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cert-wizard/sim-investor-breakdown.test.tsx
```

- [ ] **Step 3: Implement**

```tsx
import { fmtMoney2 } from '@/lib/format/money';
import { fmtDate } from '@/lib/format/date';
import type { SimulationResult } from '@/lib/types/certificate';

interface Props {
  simulation: SimulationResult;
}

export function SimInvestorBreakdown({ simulation }: Props) {
  const capital = Number(simulation.capital);
  const returned = Number(simulation.investor_returned);
  const paid = Number(simulation.investor_paid);
  const yieldAmount = Number(simulation.investor_yield);
  const total = paid + yieldAmount;

  return (
    <div className="bg-card border-border-subtle rounded-lg border p-4">
      <div className="text-text-3 mb-3 text-[10px] uppercase tracking-wide">
        Resumen para el inversor
      </div>
      <Row label="Capital del inversor" amount={fmtMoney2(capital)} />
      <Row label="− No colocado (devolución)" amount={`-${fmtMoney2(returned)}`} muted />
      <RowHi label="Capital efectivamente colocado" amount={fmtMoney2(paid)} />
      <Row label="+ Intereses al vencimiento" amount={`+${fmtMoney2(yieldAmount)}`} muted />
      <RowFinal
        label={`Total a recibir el ${fmtDate(simulation.maturity_date)}`}
        amount={fmtMoney2(total)}
      />
    </div>
  );
}

function Row({ label, amount, muted = false }: { label: string; amount: string; muted?: boolean }) {
  return (
    <div className="border-border-subtle flex items-center justify-between border-b py-2">
      <span className={`text-[12px] ${muted ? 'text-text-3 italic' : ''}`}>{label}</span>
      <span className="text-[13px] font-medium tabular-nums">{amount}</span>
    </div>
  );
}

function RowHi({ label, amount }: { label: string; amount: string }) {
  return (
    <div className="bg-subtle -mx-4 flex items-center justify-between px-4 py-2.5">
      <span className="text-[13px]">{label}</span>
      <span className="text-[13px] font-semibold tabular-nums">{amount}</span>
    </div>
  );
}

function RowFinal({ label, amount }: { label: string; amount: string }) {
  return (
    <div className="bg-green-bg text-green-text -mx-4 mt-2 flex items-center justify-between px-4 py-3">
      <span className="text-[12px] font-medium">{label}</span>
      <span className="text-[14px] font-semibold tabular-nums">{amount}</span>
    </div>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cert-wizard/sim-investor-breakdown.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/cert-wizard/sim-investor-breakdown.tsx components/cert-wizard/sim-investor-breakdown.test.tsx
git commit -m "$(cat <<'EOF'
feat(cert-wizard): SimInvestorBreakdown panel

5-row breakdown: Capital → -Devolución → =Capital efectivo →
+Intereses → Total a recibir el {maturity_date}. Mirrors mockup
443031f2's "Resumen para el inversor" panel.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: `<SimConcentrationBars>`

**Files:**
- Create: `components/cert-wizard/sim-concentration-bars.tsx`
- Create: `components/cert-wizard/sim-concentration-bars.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SimConcentrationBars } from './sim-concentration-bars';

describe('<SimConcentrationBars />', () => {
  it('renders one row per merchant with name, amount, and pct', () => {
    render(
      <SimConcentrationBars
        items={[
          {
            merchant_id: 'm-1',
            current_name: 'Central Madeirense',
            rif: 'J-1',
            amount: '17478.0000',
            pct: '0.172',
          },
          {
            merchant_id: 'm-2',
            current_name: 'Corpocel Store',
            rif: 'J-2',
            amount: '9528.0000',
            pct: '0.094',
          },
        ]}
      />,
    );
    expect(screen.getByText('Central Madeirense')).toBeInTheDocument();
    expect(screen.getByText(/\$17,478/)).toBeInTheDocument();
    expect(screen.getByText(/17\.2%/)).toBeInTheDocument();
    expect(screen.getByText('Corpocel Store')).toBeInTheDocument();
    expect(screen.getByText(/9\.4%/)).toBeInTheDocument();
  });

  it('renders empty state when items is empty', () => {
    render(<SimConcentrationBars items={[]} />);
    expect(screen.getByText(/sin datos de concentraci/i)).toBeInTheDocument();
  });

  it('bar widths are proportional to top item (largest = 100%)', () => {
    const { container } = render(
      <SimConcentrationBars
        items={[
          {
            merchant_id: 'm-1',
            current_name: 'A',
            rif: 'J-1',
            amount: '100',
            pct: '0.5',
          },
          {
            merchant_id: 'm-2',
            current_name: 'B',
            rif: 'J-2',
            amount: '50',
            pct: '0.25',
          },
        ]}
      />,
    );
    const bars = container.querySelectorAll('[data-testid="conc-bar"]');
    expect((bars[0] as HTMLElement).style.width).toBe('100%');
    expect((bars[1] as HTMLElement).style.width).toBe('50%');
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cert-wizard/sim-concentration-bars.test.tsx
```

- [ ] **Step 3: Implement**

```tsx
import { fmtMoney2 } from '@/lib/format/money';
import { fmtPct } from '@/lib/format/percent';
import type { SimConcentrationItem } from '@/lib/types/certificate';

interface Props {
  items: SimConcentrationItem[];
}

export function SimConcentrationBars({ items }: Props) {
  if (items.length === 0) {
    return (
      <div className="bg-card border-border-subtle rounded-lg border p-4">
        <div className="text-text-3 mb-3 text-[10px] uppercase tracking-wide">
          Concentración por comercio
        </div>
        <div className="text-text-3 py-6 text-center text-[12px]">
          Sin datos de concentración.
        </div>
      </div>
    );
  }
  const max = items.reduce((m, it) => Math.max(m, Number(it.amount)), 0);
  return (
    <div className="bg-card border-border-subtle rounded-lg border p-4">
      <div className="text-text-3 mb-3 text-[10px] uppercase tracking-wide">
        Concentración por comercio (top {items.length})
      </div>
      <div className="grid grid-cols-[1fr_70px_120px] items-center gap-3">
        {items.map((it) => {
          const widthPct = max > 0 ? (Number(it.amount) / max) * 100 : 0;
          return (
            <div key={it.merchant_id} className="contents">
              <div className="truncate text-[12px] font-medium" title={it.current_name}>
                {it.current_name}
              </div>
              <div className="bg-subtle h-1 w-full overflow-hidden rounded">
                <div
                  data-testid="conc-bar"
                  style={{ width: `${widthPct}%` }}
                  className="bg-foreground h-full"
                />
              </div>
              <div className="text-text-3 text-right text-[11px] tabular-nums">
                {fmtMoney2(Number(it.amount))} · {fmtPct(it.pct)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cert-wizard/sim-concentration-bars.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/cert-wizard/sim-concentration-bars.tsx components/cert-wizard/sim-concentration-bars.test.tsx
git commit -m "$(cat <<'EOF'
feat(cert-wizard): SimConcentrationBars panel

Top 5 merchants in the pool with proportional bars + amount + pct.
Uses simulation.concentration_top from the back. Empty state when
the back returns no items.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: `<SimMaturityTimeline>`

**Files:**
- Create: `components/cert-wizard/sim-maturity-timeline.tsx`
- Create: `components/cert-wizard/sim-maturity-timeline.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SimMaturityTimeline } from './sim-maturity-timeline';

describe('<SimMaturityTimeline />', () => {
  it('renders a point per due date with formatted amount', () => {
    render(
      <SimMaturityTimeline
        items={[
          { date: '2026-04-27', amount: '0' },
          { date: '2026-05-04', amount: '32180' },
          { date: '2026-06-08', amount: '27252' },
        ]}
      />,
    );
    expect(screen.getByText('27/04')).toBeInTheDocument();
    expect(screen.getByText('04/05')).toBeInTheDocument();
    expect(screen.getByText('08/06')).toBeInTheDocument();
    expect(screen.getByText('$32,180')).toBeInTheDocument();
  });

  it('shows empty state when no items', () => {
    render(<SimMaturityTimeline items={[]} />);
    expect(screen.getByText(/sin distribuci/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cert-wizard/sim-maturity-timeline.test.tsx
```

- [ ] **Step 3: Implement**

```tsx
import { fmtMoney } from '@/lib/format/money';
import type { SimDueDateItem } from '@/lib/types/certificate';

interface Props {
  items: SimDueDateItem[];
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

export function SimMaturityTimeline({ items }: Props) {
  if (items.length === 0) {
    return (
      <div className="bg-card border-border-subtle rounded-lg border p-4">
        <div className="text-text-3 mb-3 text-[10px] uppercase tracking-wide">
          Distribución de vencimientos
        </div>
        <div className="text-text-3 py-6 text-center text-[12px]">
          Sin distribución de vencimientos.
        </div>
      </div>
    );
  }
  return (
    <div className="bg-card border-border-subtle rounded-lg border p-4">
      <div className="text-text-3 mb-3 text-[10px] uppercase tracking-wide">
        Distribución de vencimientos
      </div>
      <div className="relative flex items-start justify-between gap-2 px-1">
        <div className="bg-border-subtle absolute left-[8%] right-[8%] top-[4px] h-[1px]" />
        {items.map((p) => (
          <div
            key={p.date}
            className="relative z-10 flex flex-1 flex-col items-center"
          >
            <div className="bg-foreground border-foreground mb-2 h-2 w-2 rounded-full border-2 box-content" />
            <div className="text-[10px] font-semibold tabular-nums">{shortDate(p.date)}</div>
            <div className="text-text-3 mt-0.5 text-[9px] tabular-nums">
              {fmtMoney(Number(p.amount))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cert-wizard/sim-maturity-timeline.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/cert-wizard/sim-maturity-timeline.tsx components/cert-wizard/sim-maturity-timeline.test.tsx
git commit -m "$(cat <<'EOF'
feat(cert-wizard): SimMaturityTimeline panel

Horizontal timeline of installment due dates with amounts. Pulled
from simulation.due_date_distribution.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: `<SimForm>`

**Files:**
- Create: `components/cert-wizard/sim-form.tsx`
- Create: `components/cert-wizard/sim-form.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SimForm } from './sim-form';

const investor = { id: 'inv-1', legal_name: 'Alpha', rif: 'J-1' };
const params = {
  capital: '100000',
  rate: '0.13',
  term_days: 42 as const,
  issue_date: '2026-05-10',
};

describe('<SimForm />', () => {
  it('renders investor card + all 4 inputs with current values', () => {
    render(
      <SimForm
        investor={investor}
        params={params}
        onParamsChange={vi.fn()}
        onChangeInvestor={vi.fn()}
      />,
    );
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByLabelText(/capital/i)).toHaveValue(100000);
    expect(screen.getByLabelText(/tasa anual/i)).toHaveValue(13);
    expect(screen.getByLabelText(/fecha de emisi/i)).toHaveValue('2026-05-10');
    expect(screen.getByRole('button', { name: '42 días' })).toHaveAttribute(
      'data-active',
      'true',
    );
  });

  it('emits onParamsChange when capital changes', () => {
    const onParamsChange = vi.fn();
    render(
      <SimForm
        investor={investor}
        params={params}
        onParamsChange={onParamsChange}
        onChangeInvestor={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(/capital/i), { target: { value: '50000' } });
    expect(onParamsChange).toHaveBeenCalledWith({ capital: '50000' });
  });

  it('toggling term to 14 emits onParamsChange with term_days: 14', () => {
    const onParamsChange = vi.fn();
    render(
      <SimForm
        investor={investor}
        params={params}
        onParamsChange={onParamsChange}
        onChangeInvestor={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '14 días' }));
    expect(onParamsChange).toHaveBeenCalledWith({ term_days: 14 });
  });

  it('rate input shows percent (13.0) but emits decimal (0.13)', () => {
    const onParamsChange = vi.fn();
    render(
      <SimForm
        investor={investor}
        params={params}
        onParamsChange={onParamsChange}
        onChangeInvestor={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(/tasa anual/i), { target: { value: '15' } });
    expect(onParamsChange).toHaveBeenCalledWith({ rate: '0.15' });
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cert-wizard/sim-form.test.tsx
```

- [ ] **Step 3: Implement**

```tsx
'use client';

import type { CertificateTermDays } from '@/lib/types/certificate';

interface Investor {
  id: string;
  legal_name: string;
  rif: string;
}

interface Params {
  capital: string;
  rate: string;
  term_days: CertificateTermDays;
  issue_date: string;
}

interface Props {
  investor: Investor;
  params: Params;
  onParamsChange: (next: Partial<Params>) => void;
  onChangeInvestor: () => void;
}

export function SimForm({ investor, params, onParamsChange, onChangeInvestor }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <div className="text-text-3 text-[10px] uppercase tracking-wide">Parámetros</div>

      <div>
        <Label>Inversor</Label>
        <div className="border-border-subtle bg-subtle flex items-center justify-between rounded-md border p-3">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium">{investor.legal_name}</div>
            <div className="text-text-3 mt-0.5 font-mono text-[10px]">{investor.rif}</div>
          </div>
          <button
            type="button"
            onClick={onChangeInvestor}
            className="text-text-3 text-[10px] hover:underline"
          >
            Cambiar
          </button>
        </div>
      </div>

      <Field label="Capital del inversor" id="capital">
        <div className="relative">
          <span className="text-text-3 absolute left-3 top-1/2 -translate-y-1/2 text-[12px]">$</span>
          <input
            id="capital"
            type="number"
            inputMode="decimal"
            value={params.capital}
            onChange={(e) => onParamsChange({ capital: e.target.value })}
            className="border-border-subtle bg-card w-full rounded-md border py-2 pl-6 pr-3 text-[13px] tabular-nums"
          />
        </div>
      </Field>

      <Field label="Plazo del certificado" id="term">
        <div className="border-border-subtle grid grid-cols-2 gap-0 rounded-md border p-1">
          {[14, 42].map((t) => {
            const active = params.term_days === t;
            return (
              <button
                key={t}
                type="button"
                data-active={active}
                onClick={() => onParamsChange({ term_days: t as CertificateTermDays })}
                className={
                  'rounded py-2 text-[12px] font-medium transition-colors ' +
                  (active ? 'bg-foreground text-background' : 'text-text-2 hover:bg-subtle')
                }
              >
                {t} días
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Tasa anual" id="rate">
        <div className="relative">
          <input
            id="rate"
            type="number"
            inputMode="decimal"
            step="0.1"
            value={(Number(params.rate) * 100).toFixed(1).replace(/\.0$/, '')}
            onChange={(e) => onParamsChange({ rate: String(Number(e.target.value) / 100) })}
            className="border-border-subtle bg-card w-full rounded-md border py-2 pl-3 pr-6 text-[13px] tabular-nums"
          />
          <span className="text-text-3 absolute right-3 top-1/2 -translate-y-1/2 text-[12px]">%</span>
        </div>
      </Field>

      <Field label="Fecha de emisión" id="issue_date">
        <input
          id="issue_date"
          type="date"
          value={params.issue_date}
          onChange={(e) => onParamsChange({ issue_date: e.target.value })}
          min={new Date().toISOString().slice(0, 10)}
          className="border-border-subtle bg-card w-full rounded-md border px-3 py-2 text-[13px]"
        />
      </Field>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-text-3 mb-1 block text-[11px]">{children}</span>;
}

function Field({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-text-3 mb-1 block text-[11px]">
        {label}
      </label>
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cert-wizard/sim-form.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/cert-wizard/sim-form.tsx components/cert-wizard/sim-form.test.tsx
git commit -m "$(cat <<'EOF'
feat(cert-wizard): SimForm

Form column for Step 2: investor card + capital + term toggle (14/42)
+ rate (% UI ↔ decimal wire) + issue_date. Stateless — receives
params via prop and emits partial updates via onParamsChange.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: `<Step2Simulation>` (composes form + preview panels)

**Files:**
- Create: `components/cert-wizard/step2-simulation.tsx`
- Create: `components/cert-wizard/step2-simulation.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithQuery } from '@/test/helpers/tanstack';
import { Step2Simulation } from './step2-simulation';

const { mockSimulate } = vi.hoisted(() => ({ mockSimulate: vi.fn() }));

vi.mock('@/lib/api/certificates', () => ({
  simulateCertificate: (...a: unknown[]) => mockSimulate(...a),
}));

const investor = { id: 'inv-1', legal_name: 'Alpha', rif: 'J-1' };
const params = {
  capital: '100000',
  rate: '0.13',
  term_days: 42 as const,
  issue_date: '2026-05-10',
};

const mockSim = {
  investor,
  capital: '100000',
  rate: '0.13',
  term_days: 42 as const,
  issue_date: '2026-05-10',
  maturity_date: '2026-06-21',
  price: '0.984833',
  nominal_target: '101540.6000',
  nominal_actual: '101540.0000',
  investor_paid: '99999.4100',
  investor_returned: '0.5900',
  investor_yield: '1540.5900',
  shortfall_pct: '0.000006',
  selected_orders: [],
  total_eligible_merchants: 100,
  total_distinct_merchants: 71,
  installment_plazo_days: { min: 7, max: 42 },
  concentration_top: [],
  due_date_distribution: [],
  payload_hash: 'abc',
};

describe('<Step2Simulation />', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows initial placeholder before recalculate', () => {
    renderWithQuery(
      <Step2Simulation
        investor={investor}
        params={params}
        simulation={null}
        poolChangedWarning={false}
        onParamsChange={vi.fn()}
        onSetSimulation={vi.fn()}
        onChangeInvestor={vi.fn()}
        triggerRecalculate={false}
      />,
    );
    expect(screen.getByText(/llen[aá] los par[aá]metros/i)).toBeInTheDocument();
  });

  it('triggerRecalculate=true fires the simulate mutation', async () => {
    mockSimulate.mockResolvedValueOnce(mockSim);
    const onSetSimulation = vi.fn();
    renderWithQuery(
      <Step2Simulation
        investor={investor}
        params={params}
        simulation={null}
        poolChangedWarning={false}
        onParamsChange={vi.fn()}
        onSetSimulation={onSetSimulation}
        onChangeInvestor={vi.fn()}
        triggerRecalculate={true}
      />,
    );
    await waitFor(() => expect(mockSimulate).toHaveBeenCalled());
    await waitFor(() => expect(onSetSimulation).toHaveBeenCalledWith(mockSim));
  });

  it('renders preview panels when simulation prop is provided', () => {
    renderWithQuery(
      <Step2Simulation
        investor={investor}
        params={params}
        simulation={mockSim}
        poolChangedWarning={false}
        onParamsChange={vi.fn()}
        onSetSimulation={vi.fn()}
        onChangeInvestor={vi.fn()}
        triggerRecalculate={false}
      />,
    );
    expect(screen.getByText(/las 3 reglas se cumplen/i)).toBeInTheDocument();
    expect(screen.getByText('71')).toBeInTheDocument();
  });

  it('shows poolChangedWarning banner when prop is true', () => {
    renderWithQuery(
      <Step2Simulation
        investor={investor}
        params={params}
        simulation={null}
        poolChangedWarning={true}
        onParamsChange={vi.fn()}
        onSetSimulation={vi.fn()}
        onChangeInvestor={vi.fn()}
        triggerRecalculate={false}
      />,
    );
    expect(screen.getByText(/el pool cambi/i)).toBeInTheDocument();
  });

  it('shows error message on simulate failure', async () => {
    mockSimulate.mockRejectedValueOnce(new Error('No hay órdenes elegibles'));
    renderWithQuery(
      <Step2Simulation
        investor={investor}
        params={params}
        simulation={null}
        poolChangedWarning={false}
        onParamsChange={vi.fn()}
        onSetSimulation={vi.fn()}
        onChangeInvestor={vi.fn()}
        triggerRecalculate={true}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(/no hay [oó]rdenes elegibles/i)).toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cert-wizard/step2-simulation.test.tsx
```

- [ ] **Step 3: Implement**

```tsx
'use client';

import { useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { simulateCertificate } from '@/lib/api/certificates';
import { fmtMoney2 } from '@/lib/format/money';
import { fmtPct } from '@/lib/format/percent';
import { fmtDate } from '@/lib/format/date';
import type { SimulationResult, CertificateTermDays } from '@/lib/types/certificate';
import { SimForm } from './sim-form';
import { SimRulesBadge } from './sim-rules-badge';
import { SimStatCards } from './sim-stat-cards';
import { SimInvestorBreakdown } from './sim-investor-breakdown';
import { SimConcentrationBars } from './sim-concentration-bars';
import { SimMaturityTimeline } from './sim-maturity-timeline';

interface Params {
  capital: string;
  rate: string;
  term_days: CertificateTermDays;
  issue_date: string;
}

interface Props {
  investor: { id: string; legal_name: string; rif: string };
  params: Params;
  simulation: SimulationResult | null;
  poolChangedWarning: boolean;
  triggerRecalculate: boolean;
  onParamsChange: (next: Partial<Params>) => void;
  onSetSimulation: (sim: SimulationResult) => void;
  onChangeInvestor: () => void;
}

export function Step2Simulation({
  investor,
  params,
  simulation,
  poolChangedWarning,
  triggerRecalculate,
  onParamsChange,
  onSetSimulation,
  onChangeInvestor,
}: Props) {
  const mut = useMutation({
    mutationFn: simulateCertificate,
    onSuccess: onSetSimulation,
  });

  useEffect(() => {
    if (triggerRecalculate) {
      mut.mutate({
        investor_id: investor.id,
        capital: Number(params.capital),
        rate: Number(params.rate),
        term_days: params.term_days,
        issue_date: params.issue_date,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerRecalculate]);

  return (
    <div className="grid grid-cols-[320px_1fr] gap-6 px-7 py-6">
      <SimForm
        investor={investor}
        params={params}
        onParamsChange={onParamsChange}
        onChangeInvestor={onChangeInvestor}
      />
      <div className="flex flex-col gap-3">
        {poolChangedWarning && (
          <div className="bg-warn-bg text-warn-text rounded-md px-3 py-2 text-[12px]">
            El pool cambió mientras revisabas. Recalculá para volver a emitir.
          </div>
        )}
        {mut.isPending && (
          <div className="text-text-3 py-12 text-center text-sm">Simulando…</div>
        )}
        {mut.isError && !mut.isPending && (
          <div className="bg-warn-bg text-warn-text rounded-md px-3 py-2 text-[12px]">
            {mut.error instanceof Error
              ? mut.error.message
              : 'Error al simular. Reintentá.'}
          </div>
        )}
        {!mut.isPending && !mut.isError && !simulation && (
          <div className="border-border-subtle bg-subtle flex h-64 items-center justify-center rounded-lg border-2 border-dashed">
            <div className="text-text-3 text-center text-sm">
              Llená los parámetros y hacé click en Recalcular.
            </div>
          </div>
        )}
        {simulation && (
          <>
            <div className="flex items-center justify-between">
              <SimRulesBadge />
              <CalcSummary simulation={simulation} />
            </div>
            <SimStatCards simulation={simulation} />
            <SimInvestorBreakdown simulation={simulation} />
            <SimConcentrationBars items={simulation.concentration_top} />
            <SimMaturityTimeline items={simulation.due_date_distribution} />
          </>
        )}
      </div>
    </div>
  );
}

function CalcSummary({ simulation }: { simulation: SimulationResult }) {
  return (
    <div className="text-text-3 flex items-center gap-3 text-[10px] tabular-nums">
      <span>Vence {fmtDate(simulation.maturity_date)}</span>
      <span>·</span>
      <span>Precio {fmtPct(simulation.price, 4)}</span>
      <span>·</span>
      <span>Nominal {fmtMoney2(Number(simulation.nominal_target))}</span>
    </div>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cert-wizard/step2-simulation.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/cert-wizard/step2-simulation.tsx components/cert-wizard/step2-simulation.test.tsx
git commit -m "$(cat <<'EOF'
feat(cert-wizard): Step2Simulation

2-column layout. Form left, preview right. The parent toggles
triggerRecalculate to fire the /simulate mutation. Renders all 5
preview panels (rules badge, stat cards, breakdown, concentration,
timeline) when simulation prop is set. Handles pool-changed warning
+ pending + error states.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: `<Step3Confirm>`

**Files:**
- Create: `components/cert-wizard/step3-confirm.tsx`
- Create: `components/cert-wizard/step3-confirm.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithQuery } from '@/test/helpers/tanstack';
import { Step3Confirm } from './step3-confirm';

const { mockIssue, toastSuccess, toastError } = vi.hoisted(() => ({
  mockIssue: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/lib/api/certificates', () => ({
  issueCertificate: (...a: unknown[]) => mockIssue(...a),
}));

vi.mock('sonner', () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

const investor = { id: 'inv-1', legal_name: 'Alpha', rif: 'J-1' };
const sim = {
  investor,
  capital: '100000',
  rate: '0.13',
  term_days: 42 as const,
  issue_date: '2026-05-10',
  maturity_date: '2026-06-21',
  price: '0.984833',
  nominal_target: '101540.6000',
  nominal_actual: '101540.0000',
  investor_paid: '99999.4100',
  investor_returned: '0.5900',
  investor_yield: '1540.5900',
  shortfall_pct: '0',
  selected_orders: [
    { id: 'o-1', installments_sum: '0', merchant_id: 'm-1', num_installments: 3, max_due_date: '2026-06-01' },
    { id: 'o-2', installments_sum: '0', merchant_id: 'm-1', num_installments: 3, max_due_date: '2026-06-01' },
  ],
  total_eligible_merchants: 71,
  total_distinct_merchants: 1,
  installment_plazo_days: { min: 7, max: 42 },
  concentration_top: [],
  due_date_distribution: [],
  payload_hash: 'hash-abc',
};

describe('<Step3Confirm />', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders investor + terms summary', () => {
    renderWithQuery(
      <Step3Confirm
        simulation={sim}
        triggerConfirm={false}
        onPoolChanged={vi.fn()}
        onSuccess={vi.fn()}
        onConfirmStart={vi.fn()}
        onConfirmEnd={vi.fn()}
      />,
    );
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('J-1')).toBeInTheDocument();
    expect(screen.getByText('$100,000.00')).toBeInTheDocument();
    expect(screen.getByText('42 días')).toBeInTheDocument();
  });

  it('triggerConfirm=true posts /certificates with order_ids and payload_hash', async () => {
    mockIssue.mockResolvedValueOnce({ id: 'c-1', code: 'C0001A' });
    const onSuccess = vi.fn();
    renderWithQuery(
      <Step3Confirm
        simulation={sim}
        triggerConfirm={true}
        onPoolChanged={vi.fn()}
        onSuccess={onSuccess}
        onConfirmStart={vi.fn()}
        onConfirmEnd={vi.fn()}
      />,
    );
    await waitFor(() => expect(mockIssue).toHaveBeenCalled());
    expect(mockIssue.mock.calls[0][0]).toMatchObject({
      investor_id: 'inv-1',
      order_ids: ['o-1', 'o-2'],
      expected_payload_hash: 'hash-abc',
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith({ id: 'c-1', code: 'C0001A' }));
    expect(toastSuccess).toHaveBeenCalledWith(
      expect.stringContaining('C0001A'),
    );
  });

  it('on 409 calls onPoolChanged + does NOT call onSuccess', async () => {
    const err = new Error('payload_hash mismatch') as Error & { status?: number };
    err.status = 409;
    mockIssue.mockRejectedValueOnce(err);
    const onPoolChanged = vi.fn();
    const onSuccess = vi.fn();
    renderWithQuery(
      <Step3Confirm
        simulation={sim}
        triggerConfirm={true}
        onPoolChanged={onPoolChanged}
        onSuccess={onSuccess}
        onConfirmStart={vi.fn()}
        onConfirmEnd={vi.fn()}
      />,
    );
    await waitFor(() => expect(onPoolChanged).toHaveBeenCalledTimes(1));
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cert-wizard/step3-confirm.test.tsx
```

- [ ] **Step 3: Implement**

```tsx
'use client';

import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { issueCertificate } from '@/lib/api/certificates';
import { fmtMoney2 } from '@/lib/format/money';
import { fmtPct } from '@/lib/format/percent';
import { fmtDate } from '@/lib/format/date';
import type { Certificate, SimulationResult } from '@/lib/types/certificate';

interface Props {
  simulation: SimulationResult;
  triggerConfirm: boolean;
  onPoolChanged: () => void;
  onSuccess: (cert: Certificate) => void;
  onConfirmStart: () => void;
  onConfirmEnd: () => void;
}

export function Step3Confirm({
  simulation,
  triggerConfirm,
  onPoolChanged,
  onSuccess,
  onConfirmStart,
  onConfirmEnd,
}: Props) {
  const qc = useQueryClient();

  const mut = useMutation({
    mutationFn: issueCertificate,
    onMutate: () => onConfirmStart(),
    onSuccess: (cert) => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['orders-stats'] });
      qc.invalidateQueries({ queryKey: ['certs-this-week'] });
      toast.success(`Certificado ${cert.code} emitido`);
      onSuccess(cert);
      onConfirmEnd();
    },
    onError: (err) => {
      const status = (err as { status?: number }).status;
      if (status === 409) {
        onPoolChanged();
      } else {
        toast.error(err instanceof Error ? err.message : 'Error al emitir');
      }
      onConfirmEnd();
    },
  });

  useEffect(() => {
    if (triggerConfirm) {
      mut.mutate({
        investor_id: simulation.investor.id,
        capital: Number(simulation.capital),
        rate: Number(simulation.rate),
        term_days: simulation.term_days,
        issue_date: simulation.issue_date,
        order_ids: simulation.selected_orders.map((o) => o.id),
        expected_payload_hash: simulation.payload_hash,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerConfirm]);

  const totalPaid = Number(simulation.investor_paid) + Number(simulation.investor_yield);

  return (
    <div className="flex flex-col gap-4 px-7 py-6">
      <div className="text-[13px]">Vas a emitir un certificado con los siguientes términos:</div>
      <div className="grid grid-cols-2 gap-3">
        <Panel title="Inversor">
          <Row label="Razón social" value={simulation.investor.legal_name} mono={false} />
          <Row label="RIF" value={simulation.investor.rif} mono />
        </Panel>
        <Panel title="Términos">
          <Row label="Capital" value={fmtMoney2(Number(simulation.capital))} />
          <Row label="Tasa" value={fmtPct(simulation.rate)} />
          <Row label="Plazo" value={`${simulation.term_days} días`} />
          <Row label="Emisión" value={fmtDate(simulation.issue_date)} />
          <Row label="Vence" value={fmtDate(simulation.maturity_date)} />
        </Panel>
      </div>
      <Panel title="Pool">
        <Row label="Nominal del certificado" value={fmtMoney2(Number(simulation.nominal_target))} />
        <Row label="Total a recibir" value={fmtMoney2(totalPaid)} />
        <Row label="Órdenes empaquetadas" value={String(simulation.selected_orders.length)} />
        <Row label="Comercios distintos" value={String(simulation.total_distinct_merchants)} />
      </Panel>
      <div className="bg-warn-bg text-warn-text rounded-md px-3 py-2 text-[12px]">
        ⚠️ Esta emisión es irreversible salvo cancelación posterior.
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border-border-subtle rounded-lg border p-4">
      <div className="text-text-3 mb-3 text-[10px] uppercase tracking-wide">{title}</div>
      {children}
    </div>
  );
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="border-border-subtle flex items-center justify-between border-b py-2 last:border-0">
      <span className="text-text-3 text-[11px]">{label}</span>
      <span
        className={
          'text-[12px] font-medium tabular-nums ' + (mono ? 'font-mono' : '')
        }
      >
        {value}
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cert-wizard/step3-confirm.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/cert-wizard/step3-confirm.tsx components/cert-wizard/step3-confirm.test.tsx
git commit -m "$(cat <<'EOF'
feat(cert-wizard): Step3Confirm

Final read-only summary + irreversibility disclaimer. Parent toggles
triggerConfirm to fire issueCertificate. On 409 → onPoolChanged
(parent transitions to Step 2 with warning); on success → toast +
invalidate Stock queries + onSuccess(cert).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 19: `<NewCertWizard>` orchestrator

**Files:**
- Create: `components/cert-wizard/new-cert-wizard.tsx`
- Create: `components/cert-wizard/new-cert-wizard.test.tsx`

- [ ] **Step 1: Failing test (smoke)**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithQuery } from '@/test/helpers/tanstack';
import { NewCertWizard } from './new-cert-wizard';

const { mockListInvestors, mockSimulate, mockIssue, mockCreate } = vi.hoisted(() => ({
  mockListInvestors: vi.fn(),
  mockSimulate: vi.fn(),
  mockIssue: vi.fn(),
  mockCreate: vi.fn(),
}));

vi.mock('@/lib/api/investors', () => ({
  listInvestors: (...a: unknown[]) => mockListInvestors(...a),
  createInvestor: (...a: unknown[]) => mockCreate(...a),
}));

vi.mock('@/lib/api/certificates', () => ({
  simulateCertificate: (...a: unknown[]) => mockSimulate(...a),
  issueCertificate: (...a: unknown[]) => mockIssue(...a),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const investor = {
  id: 'inv-1',
  legal_name: 'Alpha',
  rif: 'J-1',
  kind: 'juridica' as const,
  status: 'active' as const,
  email: null,
  phone: null,
};

const mockSim = {
  investor: { id: 'inv-1', legal_name: 'Alpha', rif: 'J-1' },
  capital: '100000',
  rate: '0.13',
  term_days: 42 as const,
  issue_date: '2026-05-10',
  maturity_date: '2026-06-21',
  price: '0.984833',
  nominal_target: '101540',
  nominal_actual: '101540',
  investor_paid: '99999.41',
  investor_returned: '0.59',
  investor_yield: '1540.59',
  shortfall_pct: '0',
  selected_orders: [
    { id: 'o-1', installments_sum: '100', merchant_id: 'm-1', num_installments: 3, max_due_date: '2026-06-01' },
  ],
  total_eligible_merchants: 71,
  total_distinct_merchants: 1,
  installment_plazo_days: { min: 7, max: 42 },
  concentration_top: [],
  due_date_distribution: [],
  payload_hash: 'h',
};

describe('<NewCertWizard />', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListInvestors.mockResolvedValue({ data: [investor], total: 1, limit: 50, offset: 0 });
  });

  it('starts on Step 1 with the investor list', async () => {
    renderWithQuery(<NewCertWizard onClose={vi.fn()} />);
    expect(screen.getByText('Datos del inversor')).toHaveAttribute('class', expect.stringContaining('text-foreground'));
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
  });

  it('selecting an investor advances to Step 2', async () => {
    renderWithQuery(<NewCertWizard onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Alpha'));
    await waitFor(() =>
      expect(screen.getByText(/llen[aá] los par[aá]metros/i)).toBeInTheDocument(),
    );
  });

  it('full flow: select investor → Recalcular → Emitir → Confirmar emisión closes modal', async () => {
    mockSimulate.mockResolvedValueOnce(mockSim);
    mockIssue.mockResolvedValueOnce({ id: 'c-1', code: 'C0001A' });
    const onClose = vi.fn();

    renderWithQuery(<NewCertWizard onClose={onClose} />);
    // Step 1
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Alpha'));
    // Step 2
    await waitFor(() =>
      expect(screen.getByText(/llen[aá] los par[aá]metros/i)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: /recalcular/i }));
    await waitFor(() => expect(mockSimulate).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/las 3 reglas se cumplen/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /emitir/i }));
    // Step 3
    await waitFor(() =>
      expect(screen.getByText(/irreversible/i)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: /confirmar emisi[oó]n/i }));
    await waitFor(() => expect(mockIssue).toHaveBeenCalled());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('clicking the backdrop calls onClose', async () => {
    const onClose = vi.fn();
    const { container } = renderWithQuery(<NewCertWizard onClose={onClose} />);
    fireEvent.click(container.querySelector('[data-testid="cert-wizard-backdrop"]')!);
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cert-wizard/new-cert-wizard.test.tsx
```

- [ ] **Step 3: Implement**

```tsx
'use client';

import { useReducer, useState } from 'react';
import { initialWizardState, wizardReducer } from './wizard-state';
import { StepIndicator } from './step-indicator';
import { Step1Investor } from './step1-investor';
import { Step2Simulation } from './step2-simulation';
import { Step3Confirm } from './step3-confirm';
import { WizardFooter } from './wizard-footer';

interface Props {
  onClose: () => void;
}

export function NewCertWizard({ onClose }: Props) {
  const [state, dispatch] = useReducer(wizardReducer, initialWizardState);
  const [step2RecalcTick, setStep2RecalcTick] = useState(0);
  const [step3ConfirmTick, setStep3ConfirmTick] = useState(0);
  const [busy, setBusy] = useState(false);

  return (
    <div
      data-testid="cert-wizard-backdrop"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-12"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-card w-full max-w-[880px] overflow-hidden rounded-xl"
      >
        <header className="border-border-subtle flex items-start justify-between border-b px-7 py-5">
          <div>
            <h2 className="text-[18px] font-semibold tracking-[-0.2px]">Nuevo certificado</h2>
            <div className="text-text-3 mt-1 text-[12px]">
              Empaqueta órdenes del stock disponible bajo las 3 reglas del producto.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="bg-subtle text-text-2 flex h-7 w-7 items-center justify-center rounded-md text-[14px]"
          >
            ×
          </button>
        </header>

        <StepIndicator current={state.step} />

        {state.step === 1 && (
          <Step1Investor
            onSelect={(investor) =>
              dispatch({
                type: 'SET_INVESTOR',
                investor: { id: investor.id, legal_name: investor.legal_name, rif: investor.rif },
              })
            }
          />
        )}

        {state.step === 2 && state.investor && (
          <Step2Simulation
            investor={state.investor}
            params={state.params}
            simulation={state.simulation}
            poolChangedWarning={state.poolChangedWarning}
            triggerRecalculate={step2RecalcTick > 0}
            onParamsChange={(p) => dispatch({ type: 'SET_PARAMS', params: p })}
            onSetSimulation={(sim) => dispatch({ type: 'SET_SIMULATION', simulation: sim })}
            onChangeInvestor={() => dispatch({ type: 'GO_TO_STEP', step: 1 })}
          />
        )}

        {state.step === 3 && state.simulation && (
          <Step3Confirm
            simulation={state.simulation}
            triggerConfirm={step3ConfirmTick > 0}
            onPoolChanged={() => {
              dispatch({ type: 'POOL_CHANGED' });
              setStep3ConfirmTick(0);
            }}
            onSuccess={() => onClose()}
            onConfirmStart={() => setBusy(true)}
            onConfirmEnd={() => setBusy(false)}
          />
        )}

        <WizardFooter
          step={state.step}
          hasSimulation={state.simulation !== null}
          canContinue={
            (state.step === 1 && state.investor !== null) ||
            (state.step === 2 && state.simulation !== null) ||
            state.step === 3
          }
          busy={busy}
          onCancel={onClose}
          onBack={() =>
            dispatch({
              type: 'GO_TO_STEP',
              step: (state.step - 1) as 1 | 2,
            })
          }
          onContinue={() => {
            if (state.step === 1) dispatch({ type: 'GO_TO_STEP', step: 2 });
            else if (state.step === 2) dispatch({ type: 'GO_TO_STEP', step: 3 });
          }}
          onRecalculate={() => setStep2RecalcTick((t) => t + 1)}
          onConfirm={() => {
            if (state.step === 2) dispatch({ type: 'GO_TO_STEP', step: 3 });
            else if (state.step === 3) setStep3ConfirmTick((t) => t + 1);
          }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cert-wizard/new-cert-wizard.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/cert-wizard/new-cert-wizard.tsx components/cert-wizard/new-cert-wizard.test.tsx
git commit -m "$(cat <<'EOF'
feat(cert-wizard): NewCertWizard orchestrator

Modal + reducer + step routing. The footer's onRecalculate /
onConfirm bump tick counters that cascade into Step2/Step3 children
via triggerRecalculate / triggerConfirm props (so the parent does
not own the mutations directly).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 20: `<NewCertButton>` (permission-gated)

**Files:**
- Create: `components/cert-wizard/new-cert-button.tsx`
- Create: `components/cert-wizard/new-cert-button.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NewCertButton } from './new-cert-button';
import { UserProvider } from '@/lib/auth/user-context';

const operator = {
  id: 'u-1',
  email: 'op@x.com',
  full_name: 'Op',
  role: 'operator' as const,
};
const auditor = { ...operator, role: 'auditor' as const };

describe('<NewCertButton />', () => {
  it('renders for operator and calls onClick', () => {
    const onClick = vi.fn();
    render(
      <UserProvider user={operator}>
        <NewCertButton onClick={onClick} />
      </UserProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /nuevo certificado/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does NOT render for auditor (no certificate.simulate permission)', () => {
    render(
      <UserProvider user={auditor}>
        <NewCertButton onClick={vi.fn()} />
      </UserProvider>,
    );
    expect(screen.queryByRole('button', { name: /nuevo certificado/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cert-wizard/new-cert-button.test.tsx
```

- [ ] **Step 3: Implement**

```tsx
'use client';

import { hasPermission } from '@/lib/permissions/has-permission';
import { useUser } from '@/lib/auth/user-context';

interface Props {
  onClick: () => void;
}

export function NewCertButton({ onClick }: Props) {
  const user = useUser();
  if (!hasPermission(user.role, 'certificate.simulate')) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="bg-foreground text-background rounded-md px-4 py-2 text-[12px] font-medium hover:opacity-90"
    >
      + Nuevo certificado
    </button>
  );
}
```

> Note: if `hasPermission` does not yet enumerate `'certificate.simulate'`, the implementer must add it to the permission map in `lib/permissions/has-permission.ts` (operator + admin allowed; auditor not). Run `pnpm test lib/permissions/has-permission.test.ts` after to confirm tests still pass.

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cert-wizard/new-cert-button.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/cert-wizard/new-cert-button.tsx components/cert-wizard/new-cert-button.test.tsx lib/permissions/has-permission.ts lib/permissions/has-permission.test.ts
git commit -m "$(cat <<'EOF'
feat(cert-wizard): NewCertButton + certificate.simulate permission

Button gated on certificate.simulate (operator + admin allowed,
auditor blocked). Mirrors the gating pattern of UploadButton.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 21: Mount in `<StockPage>`

**Files:**
- Modify: `components/stock/stock-page.tsx`

- [ ] **Step 1: Inspect existing**

```bash
cd /Users/llam/dev/araguaney_front
cat components/stock/stock-page.tsx
```

It currently renders PageHeader + Banner + Filters + Table. Modify to:
1. Import `useState`, `NewCertButton`, `NewCertWizard`
2. Add `wizardOpen` state
3. Pass `actions={<NewCertButton onClick={() => setWizardOpen(true)} />}` to PageHeader
4. Conditionally render `<NewCertWizard onClose={() => setWizardOpen(false)} />`

- [ ] **Step 2: Apply edits**

Edit `/Users/llam/dev/araguaney_front/components/stock/stock-page.tsx` to:

```tsx
'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { StockStatsBanner } from './stock-stats-banner';
import { StockFilters, type StockFiltersValue } from './stock-filters';
import { StockTable } from './stock-table';
import { NewCertButton } from '@/components/cert-wizard/new-cert-button';
import { NewCertWizard } from '@/components/cert-wizard/new-cert-wizard';

const INITIAL_FILTERS: StockFiltersValue = {
  status: 'available',
  merchantId: null,
  maxDueDateLte: null,
  q: '',
};

export function StockPage() {
  const [filters, setFiltersInternal] = useState<StockFiltersValue>(INITIAL_FILTERS);
  const [page, setPage] = useState(0);
  const [wizardOpen, setWizardOpen] = useState(false);

  function setFilters(next: StockFiltersValue) {
    setFiltersInternal(next);
    setPage(0);
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] px-9 py-7">
      <PageHeader
        breadcrumb={{ section: 'Operación', current: 'Stock de órdenes' }}
        title="Stock de órdenes"
        actions={<NewCertButton onClick={() => setWizardOpen(true)} />}
      />
      <div className="mt-6 flex flex-col gap-6">
        <StockStatsBanner />
        <StockFilters value={filters} onChange={setFilters} />
        <StockTable filters={filters} page={page} onPageChange={setPage} />
      </div>
      {wizardOpen && <NewCertWizard onClose={() => setWizardOpen(false)} />}
    </div>
  );
}
```

- [ ] **Step 3: Verify suite**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check && pnpm build
```

Expected: all clean. The existing `<StockPage>` test (`stock-page.test.tsx`) should still pass — the wizard is mounted only when `wizardOpen=true` so it doesn't render in those test paths. If a test fails because `<NewCertButton>` requires `<UserProvider>`, wrap the existing tests with the provider (mock as operator).

- [ ] **Step 4: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/stock/stock-page.tsx components/stock/stock-page.test.tsx
git commit -m "$(cat <<'EOF'
feat(stock): mount NewCertButton + NewCertWizard

The Stock page now offers "+ Nuevo certificado" in the page header.
On click, the wizard modal opens; on close, modal unmounts and the
StockPage stays.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 22: Local smoke + visual sanity

**Files:** none (verification only).

- [ ] **Step 1: Boot dev**

```bash
cd /Users/llam/dev/araguaney_front
lsof -ti:3000 | xargs kill -9 2>/dev/null
pnpm dev > /tmp/front-task22.log 2>&1 &
PID=$!
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if grep -q "Ready in" /tmp/front-task22.log 2>/dev/null; then echo "ready in ${i}s"; break; fi
  sleep 1
done
```

- [ ] **Step 2: Verify route gating**

```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3000/stock
# Expected: 307 → /login
```

- [ ] **Step 3: Visual flow in browser**

Login as `operator` → `/stock` → "+ Nuevo certificado" button visible in the page header.

Click → modal opens, Step 1 active. List of investors loads. Select one → Step 2 active.

Step 2: form populated with capital $100,000 / rate 13.0% / 42 days / today. Click "Recalcular" → spinner, then preview populates with all 5 panels.

Click "Emitir certificado →" → Step 3. Review summary + disclaimer. Click "Confirmar emisión" → loading button, then toast "Certificado X emitido", modal closes, Stock table refreshes (orders move from `available` to `assigned`).

Negative checks:
- Click backdrop → modal closes (cancel)
- Step 2 with capital absurdly low (e.g. $0.01) → Recalcular returns 422 / "no elegibles" → error inline
- Step 1 → "Nuevo" tab → fill form → "Crear inversor" → on success, advance to Step 2 with the new investor selected

Login as `auditor` → `/stock` → "+ Nuevo certificado" button is NOT visible.

- [ ] **Step 4: Stop dev**

```bash
kill $PID; wait $PID 2>/dev/null
```

- [ ] **Step 5: No commit**

Verification only. If anything broke, fix on the same branch and re-verify.

---

## Task 23: Push branch + open PR

**Files:** none.

- [ ] **Step 1: Push**

```bash
cd /Users/llam/dev/araguaney_front
git push -u origin feat/slice-4-cert-wizard
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "feat: Slice 4 — wizard de Nuevo Certificado" --body "$(cat <<'EOF'
## Summary

Modal de 3 pasos para emitir un certificado bursátil contra el stock disponible. Lanzado desde `/stock` con un nuevo botón "+ Nuevo certificado" gated por permiso `certificate.simulate`.

## What's new

**Foundation:**
- `lib/types/investor.ts`, `lib/types/certificate.ts`
- `lib/format/percent.ts`
- `lib/api/investors.ts` (listInvestors, createInvestor)
- `lib/api/certificates.ts` extendido con simulateCertificate, issueCertificate

**Wizard core:**
- `wizard-state.ts` — reducer + initial state + actions
- `step-indicator.tsx`, `wizard-footer.tsx`, `new-cert-button.tsx`

**Step 1 (investor):**
- `investor-list.tsx`, `investor-create-form.tsx`, `step1-investor.tsx`

**Step 2 (simulation):**
- `sim-rules-badge.tsx`, `sim-stat-cards.tsx`, `sim-investor-breakdown.tsx`,
  `sim-concentration-bars.tsx`, `sim-maturity-timeline.tsx`,
  `sim-form.tsx`, `step2-simulation.tsx`

**Step 3 (confirmation):**
- `step3-confirm.tsx`

**Orchestrator + integration:**
- `new-cert-wizard.tsx`
- `stock-page.tsx` modified to mount the button + wizard

## Behavior highlights

- Step 2 fires `POST /api/certificates/simulate` only when the user clicks "Recalcular" (no auto-debounce).
- Step 3 fires `POST /api/certificates` on "Confirmar emisión", invalidates `['orders']` + `['orders-stats']` + `['certs-this-week']`, shows toast, closes modal.
- `409 payload_hash mismatch` between simulate and issue is handled: dispatch `POOL_CHANGED` action → wizard returns to Step 2 with a yellow warning banner; the user must Recalcular before retrying.
- All buttons disabled while a mutation is pending.

## Test Plan

- [x] `pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check && pnpm build` — all clean
- [x] Local smoke: full flow + cancel + 409 simulation + auditor gating
- [ ] Vercel preview deploy renders without console errors
- [ ] Real production smoke: emit a small certificate against staging data; cancel via /api/certificates/{id}/cancel after to keep DB tidy
- [ ] Permissions verified: auditor sees no button

## Notes

- Lista + detail page de certificados → Slice 5
- Sweep certificate (interno semanal) → slice aparte
- Cancelar certificado emitido → Slice 5
- Investor edit → slice aparte de inversores
- Auto-recalc con debounce → si Tesorería lo pide

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

- ✅ 3-step wizard launched from `/stock` — Tasks 19, 20, 21
- ✅ Step 1 with select existing + create new — Tasks 8, 9, 10
- ✅ Step 2 with form + 5 preview panels — Tasks 11–17
- ✅ Step 3 confirm + irreversibility disclaimer — Task 18
- ✅ wizardReducer state machine — Task 5
- ✅ Server Actions for investors + certificates — Tasks 3, 4
- ✅ Hand-typed shapes — Task 1
- ✅ percent formatter — Task 2
- ✅ Step 2 → 3 transition without immediate POST — Task 19 (orchestrator separates "Emitir →" advance from "Confirmar emisión" commit)
- ✅ 409 payload_hash mismatch handled (POOL_CHANGED action) — Tasks 5, 18, 19
- ✅ TanStack invalidation of `['orders']` + `['orders-stats']` + `['certs-this-week']` on issue success — Task 18
- ✅ Auditor gating on the new button — Task 20
- ✅ Smoke + PR — Tasks 22, 23

**Placeholder scan:** No `TODO`/`TBD`/`fill in` / "implement later" markers. Sample test data uses concrete values. The Task 20 implementation note about adding `'certificate.simulate'` to the permission map is intentional context, not a placeholder — it points the implementer to a concrete file with a concrete addition.

**Type consistency:**
- `WizardState` defined in Task 5 used by `<NewCertWizard>` (Task 19) ✓
- `SimulationResult`, `Certificate`, `InvestorSummary` from Task 1 used in Tasks 3, 4, 12, 13, 14, 15, 17, 18, 19 ✓
- `SimulateCertificateBody`, `IssueCertificateBody` from Task 4 used in Tasks 17, 18 ✓
- `SimConcentrationItem`, `SimDueDateItem` from Task 1 used in Tasks 14, 15 ✓
- `CertificateTermDays` from Task 1 used by reducer (Task 5), SimForm (Task 16), simulate body (Task 4) ✓
- `Tab` type local to Task 10 — not reused elsewhere ✓

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-10-front-slice-4-cert-wizard.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, two-stage review (spec compliance + code quality) between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session with batch checkpoints.

**Which approach?**
