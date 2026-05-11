# araguaney_front Slice 6 — `/investors` CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/investors` with list + filters + register + edit. Removes the Slice 1 ComingSoon stub. Operators manage investors without dropping into the DB or the cert-wizard.

**Architecture:** One route at `/investors` with a thin Server Component shell mounting `<InvestorsPage>` client orchestrator. List uses TanStack Query (`['investors', query]`). Register reuses the existing `<InvestorCreateForm>` from the wizard via a thin modal wrapper. Edit is a new modal calling `PATCH /api/investors/:id` with dirty-field-only payloads.

**Tech Stack:** Next.js 16 App Router, TanStack Query v5, shadcn/ui base-nova primitives, `<Pill>`, sonner toasts, Vitest + Testing Library, hand-typed shapes.

**Spec:** `/Users/llam/dev/araguaney_back/docs/superpowers/specs/2026-05-11-front-slice-6-investors-crud-design.md`

**Working directory note:** all front code lives in `/Users/llam/dev/araguaney_front/`. Plan and spec live in `/Users/llam/dev/araguaney_back/docs/`. Implementer must `cd /Users/llam/dev/araguaney_front` for any task command.

**Pre-req branch:** Work on `feat/slice-6-investors` (Task 1 creates this from `main`).

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `lib/permissions/has-permission.ts` | modify | Drop `investor.write`; add `investor.create` + `investor.update` to OPERATOR_PERMS |
| `lib/permissions/has-permission.test.ts` | modify | Update existing tests + add 6 new tests (operator/admin/auditor × create/update) |
| `lib/types/investor.ts` | modify | Extend `InvestorSummary` with full wire shape; add `InvestorActor`, `InvestorUpdate` |
| `lib/api/investors.ts` | modify | Add `updateInvestor(id, body)` PATCH function |
| `lib/api/investors.test.ts` | modify | Test for `updateInvestor` |
| `components/investors/investor-status-pill.tsx` (+ test) | create | Active→success/Activo, inactive→neutral/Inactivo |
| `components/investors/investor-row.tsx` (+ test) | create | `<tr>` with razón social, RIF, cert count, capital, status pill; optional onEdit |
| `components/investors/investors-filters.tsx` (+ test) | create | 3 status pills + debounced (300ms) search |
| `components/investors/investors-table.tsx` (+ test) | create | useQuery + paginate + skeleton/empty/error + filter internal client-side |
| `components/investors/investor-metrics-strip.tsx` (+ test) | create | 2 cards reading shared cache |
| `components/investors/investor-create-modal.tsx` (+ test) | create | Backdrop wrapper around existing `<InvestorCreateForm>` |
| `components/investors/investor-edit-modal.tsx` (+ test) | create | Form with status toggle + dirty-field-only PATCH |
| `components/investors/investors-page.tsx` (+ test) | create | Orchestrator: header + metrics + filters + table + modal state |
| `app/(app)/investors/page.tsx` | modify | Replace ComingSoon with `<InvestorsPage />` |

**Total:** 16 new files (8 components + 8 tests) + 5 modifications.

**Manual operational tasks:**

| Action | Owner | When |
|---|---|---|
| Push branch + open PR | controller | Task 14 |
| Review + merge | user | After Task 14 |
| Verify Vercel deploy + visual smoke | user | Post-merge |

---

## Task 1: Branch + permission cleanup

**Why:** The back enforces two separate permission keys (`investor.create` and `investor.update`) but the front only declares `investor.write`. The wrong key is currently dead (no consumer), so we replace it cleanly before the new components start gating on it.

**Files:**
- Modify: `lib/permissions/has-permission.ts`
- Modify: `lib/permissions/has-permission.test.ts`

- [ ] **Step 1: Create branch from main**

```bash
cd /Users/llam/dev/araguaney_front
git fetch origin --prune
git checkout main
git pull origin main
git checkout -b feat/slice-6-investors
```

- [ ] **Step 2: Inspect existing permissions**

```bash
cd /Users/llam/dev/araguaney_front
cat lib/permissions/has-permission.ts
```

Confirm:
- `OPERATOR_PERMS` is a `const` array.
- `'investor.write'` is in it.
- `ADMIN_PERMS` spreads `OPERATOR_PERMS`.
- `AUDITOR_PERMS` does NOT have `investor.*` writes.

- [ ] **Step 3: Failing tests**

Open `/Users/llam/dev/araguaney_front/lib/permissions/has-permission.test.ts`. Find the existing tests block. Append:

```ts
describe('investor.create', () => {
  it('operator has it', () => {
    expect(hasPermission('operator', 'investor.create')).toBe(true);
  });
  it('admin has it', () => {
    expect(hasPermission('admin', 'investor.create')).toBe(true);
  });
  it('auditor does NOT have it', () => {
    expect(hasPermission('auditor', 'investor.create')).toBe(false);
  });
});

describe('investor.update', () => {
  it('operator has it', () => {
    expect(hasPermission('operator', 'investor.update')).toBe(true);
  });
  it('admin has it', () => {
    expect(hasPermission('admin', 'investor.update')).toBe(true);
  });
  it('auditor does NOT have it', () => {
    expect(hasPermission('auditor', 'investor.update')).toBe(false);
  });
});

describe('investor.write (legacy)', () => {
  it('is no longer recognized', () => {
    expect(hasPermission('operator', 'investor.write')).toBe(false);
    expect(hasPermission('admin', 'investor.write')).toBe(false);
  });
});
```

- [ ] **Step 4: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/permissions/has-permission.test.ts
```

Expected: the new `investor.create` and `investor.update` tests fail (operator returns false). The `investor.write (legacy)` test passes (auditor returned false) for one of the assertions but fails on the operator one (operator currently returns true for `investor.write`).

- [ ] **Step 5: Implement**

Edit `/Users/llam/dev/araguaney_front/lib/permissions/has-permission.ts`. Find the `OPERATOR_PERMS` array. Replace the line `'investor.write',` with the two new lines `'investor.create',` and `'investor.update',`.

The full updated `OPERATOR_PERMS` should look like:

```ts
const OPERATOR_PERMS = [
  'batch.read',
  'batch.upload',
  'order.read',
  'merchant.read',
  'investor.read',
  'investor.create',
  'investor.update',
  'certificate.read',
  'certificate.simulate',
  'certificate.create',
  'certificate.cancel',
  'audit.read',
] as const;
```

`ADMIN_PERMS` already spreads `OPERATOR_PERMS` — no change needed there. `AUDITOR_PERMS` unchanged.

- [ ] **Step 6: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/permissions/has-permission.test.ts
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

All clean.

- [ ] **Step 7: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add lib/permissions/has-permission.ts lib/permissions/has-permission.test.ts
git commit -m "$(cat <<'EOF'
feat(permissions): replace investor.write with investor.create + investor.update

Back enforces two separate keys; front had one dead key. No consumer
referenced investor.write previously, so this is a clean replacement.
Operator + admin gain both new keys; auditor unchanged.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Extend `lib/types/investor.ts`

**Why:** Back returns more fields than the current type declares (`notes`, `created_at`, `updated_at`, `updated_by`, `active_cert_count`, `total_invested`). The list page needs them all. We also need `InvestorUpdate`.

**Files:**
- Modify: `lib/types/investor.ts`

- [ ] **Step 1: Rewrite the file**

Replace the full contents of `/Users/llam/dev/araguaney_front/lib/types/investor.ts` with:

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
  total_invested: string;
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

export interface InvestorUpdate {
  legal_name?: string;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  status?: InvestorStatus;
}
```

- [ ] **Step 2: Verify typecheck reveals missing fields nowhere**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck
```

Expected: clean. Existing consumers (`<InvestorCreateForm>`, the wizard's Step1) only read `legal_name`, `rif`, and `id` from `InvestorSummary` — all still present. If typecheck complains anywhere about the new fields being required at a call site that constructs an `InvestorSummary` literal (e.g., test fixtures), update those fixtures to include the new fields.

If the wizard's Step1 test or `step3-confirm.test.tsx` constructs an `InvestorSummary` literal, those tests need the new fields too. Add them with reasonable defaults: `notes: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', updated_by: null, active_cert_count: 0, total_invested: '0.0000'`.

- [ ] **Step 3: Run full suite**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test && pnpm format:check
```

All clean.

- [ ] **Step 4: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add lib/types/investor.ts
# Stage any test fixture updates too
git add components/cert-wizard 2>/dev/null || true
git commit -m "$(cat <<'EOF'
feat(types): extend InvestorSummary to full wire shape

Adds notes, created_at, updated_at, updated_by, active_cert_count,
total_invested (Decimal serialized as string). Adds InvestorActor
and InvestorUpdate types. The /investors list page consumes these.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add `updateInvestor` to `lib/api/investors.ts`

**Files:**
- Modify: `lib/api/investors.ts`
- Modify: `lib/api/investors.test.ts`

- [ ] **Step 1: Failing test (append)**

Append to `/Users/llam/dev/araguaney_front/lib/api/investors.test.ts`:

```ts
import { updateInvestor } from './investors';

describe('updateInvestor', () => {
  beforeEach(() => vi.clearAllMocks());

  it('PATCHes /api/investors/{id} with JSON body', async () => {
    mockApiFetch.mockResolvedValueOnce({
      id: 'inv-1',
      legal_name: 'Inversora Alpha, C.A.',
      rif: 'J-12345678-9',
      kind: 'juridica',
      status: 'active',
      email: 'ops@alpha.com',
      phone: null,
      notes: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-05-11T10:00:00Z',
      updated_by: null,
      active_cert_count: 2,
      total_invested: '450000.0000',
    });
    const result = await updateInvestor('inv-1', {
      email: 'ops@alpha.com',
      status: 'active',
    });
    expect(result.email).toBe('ops@alpha.com');
    const [path, init] = mockApiFetch.mock.calls[0];
    expect(path).toBe('/api/investors/inv-1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'ops@alpha.com',
      status: 'active',
    });
  });
});
```

If the existing test file uses a different mock name (look in the file), adapt the reference. Don't introduce a new mocking strategy.

- [ ] **Step 2: Confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/api/investors.test.ts
```

Expected: 1 failure (`updateInvestor` not exported).

- [ ] **Step 3: Implement**

Open `/Users/llam/dev/araguaney_front/lib/api/investors.ts`. Add `InvestorUpdate` to the existing type imports, then append at the end of the file:

```ts
export async function updateInvestor(
  id: string,
  body: InvestorUpdate,
): Promise<InvestorSummary> {
  try {
    return await apiFetch<InvestorSummary>(`/api/investors/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  } catch (err) {
    rethrowWithMessage(err);
  }
}
```

Update the top-of-file import:

```ts
import type {
  InvestorCreate,
  InvestorSummary,
  InvestorsListResponse,
  InvestorUpdate,
} from '@/lib/types/investor';
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/api/investors.test.ts
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

All clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add lib/api/investors.ts lib/api/investors.test.ts
git commit -m "$(cat <<'EOF'
feat(api): updateInvestor PATCH endpoint

Server Action for PATCH /api/investors/:id. Same rethrowWithMessage
pattern as the rest of the investors API surface.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `<InvestorStatusPill>`

**Files:**
- Create: `components/investors/investor-status-pill.tsx`
- Create: `components/investors/investor-status-pill.test.tsx`

- [ ] **Step 1: Failing test**

```bash
cd /Users/llam/dev/araguaney_front
mkdir -p components/investors
```

Create `/Users/llam/dev/araguaney_front/components/investors/investor-status-pill.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InvestorStatusPill } from './investor-status-pill';

describe('<InvestorStatusPill />', () => {
  it('shows "Activo" with success tone for active', () => {
    render(<InvestorStatusPill status="active" />);
    expect(screen.getByText('Activo')).toBeInTheDocument();
  });

  it('shows "Inactivo" with neutral tone for inactive', () => {
    render(<InvestorStatusPill status="inactive" />);
    expect(screen.getByText('Inactivo')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/investors/investor-status-pill.test.tsx
```

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/investors/investor-status-pill.tsx`:

```tsx
import { Pill, type PillVariant } from '@/components/ui/pill';
import type { InvestorStatus } from '@/lib/types/investor';

const MAP: Record<InvestorStatus, { variant: PillVariant; label: string }> = {
  active: { variant: 'success', label: 'Activo' },
  inactive: { variant: 'neutral', label: 'Inactivo' },
};

export function InvestorStatusPill({ status }: { status: InvestorStatus }) {
  const m = MAP[status];
  return <Pill variant={m.variant}>{m.label}</Pill>;
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/investors/investor-status-pill.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/investors/investor-status-pill.tsx components/investors/investor-status-pill.test.tsx
git commit -m "$(cat <<'EOF'
feat(investors): InvestorStatusPill

Status → variant + Spanish label.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `<InvestorRow>`

**Files:**
- Create: `components/investors/investor-row.tsx`
- Create: `components/investors/investor-row.test.tsx`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/components/investors/investor-row.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InvestorRow } from './investor-row';
import type { InvestorSummary } from '@/lib/types/investor';

function mockInvestor(over: Partial<InvestorSummary> = {}): InvestorSummary {
  return {
    id: 'inv-1',
    legal_name: 'Inversora Alpha, C.A.',
    rif: 'J-12345678-9',
    kind: 'juridica',
    status: 'active',
    email: 'ops@alpha.com',
    phone: '+58-212-555-1234',
    notes: null,
    created_at: '2026-01-15T00:00:00Z',
    updated_at: '2026-05-01T10:00:00Z',
    updated_by: null,
    active_cert_count: 2,
    total_invested: '450000.0000',
    ...over,
  };
}

describe('<InvestorRow />', () => {
  function wrap(row: React.ReactElement) {
    return render(<table><tbody>{row}</tbody></table>);
  }

  it('renders all columns with formatted values', () => {
    wrap(<InvestorRow investor={mockInvestor()} onEdit={vi.fn()} />);
    expect(screen.getByText('Inversora Alpha, C.A.')).toBeInTheDocument();
    expect(screen.getByText('J-12345678-9')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('$450,000.00')).toBeInTheDocument();
    expect(screen.getByText('Activo')).toBeInTheDocument();
  });

  it('fires onEdit when clicked', () => {
    const onEdit = vi.fn();
    const inv = mockInvestor();
    wrap(<InvestorRow investor={inv} onEdit={onEdit} />);
    fireEvent.click(screen.getByText('Inversora Alpha, C.A.'));
    expect(onEdit).toHaveBeenCalledWith(inv);
  });

  it('does not fire onEdit when prop is absent', () => {
    const inv = mockInvestor();
    wrap(<InvestorRow investor={inv} />);
    fireEvent.click(screen.getByText('Inversora Alpha, C.A.'));
    // No assertion needed beyond "doesn't throw" — onEdit is optional
  });

  it('shows dash for zero capital', () => {
    wrap(<InvestorRow investor={mockInvestor({ total_invested: '0.0000' })} onEdit={vi.fn()} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/investors/investor-row.test.tsx
```

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/investors/investor-row.tsx`:

```tsx
'use client';

import { fmtMoney2 } from '@/lib/format/money';
import type { InvestorSummary } from '@/lib/types/investor';
import { InvestorStatusPill } from './investor-status-pill';

interface Props {
  investor: InvestorSummary;
  onEdit?: (investor: InvestorSummary) => void;
}

export function InvestorRow({ investor, onEdit }: Props) {
  const capital = Number(investor.total_invested);
  const interactive = !!onEdit;
  return (
    <tr
      onClick={onEdit ? () => onEdit(investor) : undefined}
      className={
        'border-border-soft border-b transition-colors ' +
        (interactive ? 'hover:bg-subtle cursor-pointer' : '')
      }
    >
      <td className="px-4 py-3.5 font-medium">{investor.legal_name}</td>
      <td className="text-text-2 px-4 py-3.5 font-mono text-[11.5px]">{investor.rif}</td>
      <td className="num px-4 py-3.5 text-right">{investor.active_cert_count}</td>
      <td className="num px-4 py-3.5 text-right font-medium">
        {capital === 0 ? <span className="text-text-3">—</span> : fmtMoney2(capital)}
      </td>
      <td className="px-4 py-3.5">
        <InvestorStatusPill status={investor.status} />
      </td>
    </tr>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/investors/investor-row.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/investors/investor-row.tsx components/investors/investor-row.test.tsx
git commit -m "$(cat <<'EOF'
feat(investors): InvestorRow

Five columns: legal_name, rif, active cert count, capital, status pill.
Click → onEdit(investor) when prop provided (gating in parent for auditor).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `<InvestorsFilters>`

**Files:**
- Create: `components/investors/investors-filters.tsx`
- Create: `components/investors/investors-filters.test.tsx`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/components/investors/investors-filters.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  InvestorsFilters,
  type InvestorsFiltersValue,
} from './investors-filters';

const DEFAULT: InvestorsFiltersValue = {
  status: 'active',
  q: '',
};

describe('<InvestorsFilters />', () => {
  it('renders 3 status pills with Activos active by default', () => {
    render(<InvestorsFilters value={DEFAULT} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Activos' })).toHaveAttribute(
      'data-active',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Todos' })).toHaveAttribute(
      'data-active',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Inactivos' })).toHaveAttribute(
      'data-active',
      'false',
    );
  });

  it('clicking "Todos" emits status: "all"', () => {
    const onChange = vi.fn();
    render(<InvestorsFilters value={DEFAULT} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Todos' }));
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT, status: 'all' });
  });

  it('clicking "Inactivos" emits status: "inactive"', () => {
    const onChange = vi.fn();
    render(<InvestorsFilters value={DEFAULT} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Inactivos' }));
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT, status: 'inactive' });
  });

  it('debounces the search input by 300ms', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<InvestorsFilters value={DEFAULT} onChange={onChange} />);
    const input = screen.getByPlaceholderText(/raz[oó]n social o rif/i);
    fireEvent.change(input, { target: { value: 'Alpha' } });
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(310);
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT, q: 'Alpha' });
    vi.useRealTimers();
  });

  it('does not emit when typed value equals current value', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<InvestorsFilters value={{ ...DEFAULT, q: 'Alpha' }} onChange={onChange} />);
    vi.advanceTimersByTime(500);
    expect(onChange).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/investors/investors-filters.test.tsx
```

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/investors/investors-filters.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import type { InvestorStatus } from '@/lib/types/investor';

export type InvestorsStatusFilter = InvestorStatus | 'all';

export interface InvestorsFiltersValue {
  status: InvestorsStatusFilter;
  q: string;
}

interface Props {
  value: InvestorsFiltersValue;
  onChange: (next: InvestorsFiltersValue) => void;
}

const STATUS_OPTIONS: Array<{ value: InvestorsStatusFilter; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'active', label: 'Activos' },
  { value: 'inactive', label: 'Inactivos' },
];

export function InvestorsFilters({ value, onChange }: Props) {
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

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <input
        type="search"
        placeholder="🔎 Razón social o RIF"
        value={qLocal}
        onChange={(e) => setQLocal(e.target.value)}
        className="border-border-subtle bg-card w-80 rounded-md border px-3 py-1.5 text-[12px]"
      />
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
    </div>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/investors/investors-filters.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/investors/investors-filters.tsx components/investors/investors-filters.test.tsx
git commit -m "$(cat <<'EOF'
feat(investors): InvestorsFilters

Three status pills (Activos default) + debounced (300ms) search by
razón social or RIF. Same pattern as CertificateFilters.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `<InvestorsTable>`

**Files:**
- Create: `components/investors/investors-table.tsx`
- Create: `components/investors/investors-table.test.tsx`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/components/investors/investors-table.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithQuery } from '@/test/helpers/tanstack';
import { InvestorsTable } from './investors-table';
import type { InvestorsFiltersValue } from './investors-filters';
import type { InvestorSummary } from '@/lib/types/investor';

const { mockList } = vi.hoisted(() => ({ mockList: vi.fn() }));

vi.mock('@/lib/api/investors', () => ({
  listInvestors: (...a: unknown[]) => mockList(...a),
}));

function inv(over: Partial<InvestorSummary> = {}): InvestorSummary {
  return {
    id: 'inv-' + Math.random(),
    legal_name: 'Inversora Alpha',
    rif: 'J-1',
    kind: 'juridica',
    status: 'active',
    email: null,
    phone: null,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    updated_by: null,
    active_cert_count: 1,
    total_invested: '100000.0000',
    ...over,
  };
}

const FILTERS: InvestorsFiltersValue = { status: 'active', q: '' };

describe('<InvestorsTable />', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows skeleton while fetching', () => {
    mockList.mockImplementation(() => new Promise(() => {}));
    renderWithQuery(<InvestorsTable filters={FILTERS} page={0} onPageChange={() => {}} />);
    expect(screen.getByText(/cargando/i)).toBeInTheDocument();
  });

  it('shows empty state when no results', async () => {
    mockList.mockResolvedValueOnce({ data: [], total: 0, limit: 50, offset: 0 });
    renderWithQuery(<InvestorsTable filters={FILTERS} page={0} onPageChange={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText(/ning[uú]n inversor/i)).toBeInTheDocument(),
    );
  });

  it('shows error state on failure', async () => {
    mockList.mockRejectedValueOnce(new Error('boom'));
    renderWithQuery(<InvestorsTable filters={FILTERS} page={0} onPageChange={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText(/no se pudieron cargar/i)).toBeInTheDocument(),
    );
  });

  it('filters out kind="internal" client-side', async () => {
    mockList.mockResolvedValueOnce({
      data: [
        inv({ legal_name: 'Visible Inv', kind: 'juridica' }),
        inv({ legal_name: 'Cashea Internal', kind: 'internal' }),
      ],
      total: 2,
      limit: 50,
      offset: 0,
    });
    renderWithQuery(<InvestorsTable filters={FILTERS} page={0} onPageChange={() => {}} />);
    await waitFor(() => expect(screen.getByText('Visible Inv')).toBeInTheDocument());
    expect(screen.queryByText('Cashea Internal')).not.toBeInTheDocument();
  });

  it('translates status="all" to undefined in listInvestors call', async () => {
    mockList.mockResolvedValueOnce({ data: [], total: 0, limit: 50, offset: 0 });
    renderWithQuery(
      <InvestorsTable
        filters={{ ...FILTERS, status: 'all' }}
        page={0}
        onPageChange={() => {}}
      />,
    );
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    expect(mockList.mock.calls[0][0].status).toBeUndefined();
  });

  it('passes onEditInvestor through to rows', async () => {
    mockList.mockResolvedValueOnce({
      data: [inv({ legal_name: 'Clickable Inv' })],
      total: 1,
      limit: 50,
      offset: 0,
    });
    const onEditInvestor = vi.fn();
    renderWithQuery(
      <InvestorsTable
        filters={FILTERS}
        page={0}
        onPageChange={() => {}}
        onEditInvestor={onEditInvestor}
      />,
    );
    await waitFor(() => expect(screen.getByText('Clickable Inv')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Clickable Inv'));
    expect(onEditInvestor).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/investors/investors-table.test.tsx
```

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/investors/investors-table.tsx`:

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { listInvestors, type ListInvestorsQuery } from '@/lib/api/investors';
import type { InvestorSummary } from '@/lib/types/investor';
import { InvestorRow } from './investor-row';
import type { InvestorsFiltersValue } from './investors-filters';

const PAGE_LIMIT = 50;

interface Props {
  filters: InvestorsFiltersValue;
  page: number;
  onPageChange: (next: number) => void;
  onEditInvestor?: (investor: InvestorSummary) => void;
}

export function buildQuery(
  filters: InvestorsFiltersValue,
  page: number,
): ListInvestorsQuery {
  return {
    limit: PAGE_LIMIT,
    offset: page * PAGE_LIMIT,
    status: filters.status === 'all' ? undefined : filters.status,
    q: filters.q || undefined,
    sort: 'name_asc',
  };
}

export function InvestorsTable({ filters, page, onPageChange, onEditInvestor }: Props) {
  const query = buildQuery(filters, page);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['investors', query],
    queryFn: () => listInvestors(query),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });

  if (isLoading) return <Skeleton />;
  if (isError) return <ErrorState onRetry={() => refetch()} />;

  // Client-side filter: back does not support kind!=internal today.
  const visible = (data?.data ?? []).filter((i) => i.kind !== 'internal');

  if (!data || visible.length === 0) return <EmptyState />;

  const start = data.offset + 1;
  const end = Math.min(data.offset + data.limit, data.total);
  const hasPrev = page > 0;
  const hasNext = data.offset + data.limit < data.total;

  return (
    <div className="bg-card border-border-subtle overflow-hidden rounded-xl border">
      <table className="w-full text-[12.5px]">
        <thead className="bg-subtle">
          <tr>
            <Th>Razón social</Th>
            <Th>RIF</Th>
            <Th align="right">Certificados</Th>
            <Th align="right">Capital activo</Th>
            <Th>Estado</Th>
          </tr>
        </thead>
        <tbody>
          {visible.map((i) => (
            <InvestorRow key={i.id} investor={i} onEdit={onEditInvestor} />
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

function Th({
  children,
  align = 'left',
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
}) {
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
      <div className="text-text-3 text-sm">Cargando inversores…</div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="border-border-subtle bg-card flex h-64 flex-col items-center justify-center gap-3 rounded-xl border">
      <div className="text-text-3 text-sm">No se pudieron cargar los inversores.</div>
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
        Ningún inversor coincide con los filtros.
      </div>
    </div>
  );
}
```

`buildQuery` is exported so `<InvestorMetricsStrip>` can re-use it to match the cache key.

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/investors/investors-table.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/investors/investors-table.tsx components/investors/investors-table.test.tsx
git commit -m "$(cat <<'EOF'
feat(investors): InvestorsTable

useQuery(['investors', query]) with 50/page pagination, loading/empty/
error states. Filters out kind='internal' client-side. Exposes
buildQuery for the metrics strip to share the cache key.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `<InvestorMetricsStrip>`

**Files:**
- Create: `components/investors/investor-metrics-strip.tsx`
- Create: `components/investors/investor-metrics-strip.test.tsx`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/components/investors/investor-metrics-strip.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithQuery } from '@/test/helpers/tanstack';
import { InvestorMetricsStrip } from './investor-metrics-strip';
import type { InvestorsFiltersValue } from './investors-filters';

const { mockList } = vi.hoisted(() => ({ mockList: vi.fn() }));

vi.mock('@/lib/api/investors', () => ({
  listInvestors: (...a: unknown[]) => mockList(...a),
}));

const FILTERS: InvestorsFiltersValue = { status: 'active', q: '' };

describe('<InvestorMetricsStrip />', () => {
  beforeEach(() => vi.clearAllMocks());

  it('counts active investors and sums their capital', async () => {
    mockList.mockResolvedValueOnce({
      data: [
        {
          id: 'a',
          legal_name: 'A',
          rif: 'J-1',
          kind: 'juridica',
          status: 'active',
          email: null,
          phone: null,
          notes: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          updated_by: null,
          active_cert_count: 2,
          total_invested: '300000.0000',
        },
        {
          id: 'b',
          legal_name: 'B',
          rif: 'J-2',
          kind: 'juridica',
          status: 'inactive',
          email: null,
          phone: null,
          notes: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          updated_by: null,
          active_cert_count: 0,
          total_invested: '0.0000',
        },
        {
          id: 'c',
          legal_name: 'C',
          rif: 'J-3',
          kind: 'juridica',
          status: 'active',
          email: null,
          phone: null,
          notes: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          updated_by: null,
          active_cert_count: 1,
          total_invested: '150000.0000',
        },
      ],
      total: 3,
      limit: 50,
      offset: 0,
    });
    renderWithQuery(<InvestorMetricsStrip filters={FILTERS} page={0} />);
    await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument());
    expect(screen.getByText('$450,000.00')).toBeInTheDocument();
  });

  it('renders zeroes when data is empty', async () => {
    mockList.mockResolvedValueOnce({ data: [], total: 0, limit: 50, offset: 0 });
    renderWithQuery(<InvestorMetricsStrip filters={FILTERS} page={0} />);
    await waitFor(() => expect(screen.getByText('0', { selector: '.text-\\[24px\\]' })).toBeInTheDocument());
  });

  it('renders placeholder during load', () => {
    mockList.mockImplementation(() => new Promise(() => {}));
    renderWithQuery(<InvestorMetricsStrip filters={FILTERS} page={0} />);
    expect(screen.getByText(/inversores activos/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/investors/investor-metrics-strip.test.tsx
```

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/investors/investor-metrics-strip.tsx`:

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { listInvestors } from '@/lib/api/investors';
import { fmtMoney2 } from '@/lib/format/money';
import { buildQuery } from './investors-table';
import type { InvestorsFiltersValue } from './investors-filters';

interface Props {
  filters: InvestorsFiltersValue;
  page: number;
}

export function InvestorMetricsStrip({ filters, page }: Props) {
  const query = buildQuery(filters, page);
  const { data } = useQuery({
    queryKey: ['investors', query],
    queryFn: () => listInvestors(query),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });

  const visible = (data?.data ?? []).filter((i) => i.kind !== 'internal');
  const actives = visible.filter((i) => i.status === 'active');
  const activeCount = actives.length;
  const totalCapital = actives.reduce((acc, i) => acc + Number(i.total_invested), 0);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card
        label="Inversores activos"
        value={String(activeCount)}
        sub={`de ${visible.length} en página`}
      />
      <Card
        label="Capital colocado"
        value={fmtMoney2(totalCapital)}
        sub="en certificados activos"
      />
    </div>
  );
}

function Card({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-card border-border-subtle rounded-xl border p-5">
      <div className="text-text-3 mb-2 text-[10px] uppercase tracking-wide">{label}</div>
      <div className="text-[24px] font-semibold tabular-nums tracking-[-0.3px]">{value}</div>
      <div className="text-text-3 mt-1 text-[11px]">{sub}</div>
    </div>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/investors/investor-metrics-strip.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/investors/investor-metrics-strip.tsx components/investors/investor-metrics-strip.test.tsx
git commit -m "$(cat <<'EOF'
feat(investors): InvestorMetricsStrip

Reads the same useQuery cache key as the table, computes active count
and total capital from the current page. Page-scoped — honest sub-label.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `<InvestorCreateModal>`

**Files:**
- Create: `components/investors/investor-create-modal.tsx`
- Create: `components/investors/investor-create-modal.test.tsx`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/components/investors/investor-create-modal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from '@/test/helpers/tanstack';
import { InvestorCreateModal } from './investor-create-modal';

const { mockCreate, toastSuccess } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('@/lib/api/investors', () => ({
  createInvestor: (...a: unknown[]) => mockCreate(...a),
}));

vi.mock('sonner', () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: vi.fn(),
  },
}));

describe('<InvestorCreateModal />', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the title and mounts the create form', () => {
    renderWithQuery(<InvestorCreateModal onClose={vi.fn()} />);
    expect(screen.getByText(/registrar inversor/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/raz[oó]n social/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^rif/i)).toBeInTheDocument();
  });

  it('on success: toasts and closes', async () => {
    mockCreate.mockResolvedValueOnce({
      id: 'inv-new',
      legal_name: 'Nuevo Fondo',
      rif: 'J-99999999-0',
      kind: 'juridica',
      status: 'active',
      email: null,
      phone: null,
      notes: null,
      created_at: '2026-05-11T10:00:00Z',
      updated_at: '2026-05-11T10:00:00Z',
      updated_by: null,
      active_cert_count: 0,
      total_invested: '0.0000',
    });
    const onClose = vi.fn();
    renderWithQuery(<InvestorCreateModal onClose={onClose} />);
    fireEvent.change(screen.getByLabelText(/raz[oó]n social/i), {
      target: { value: 'Nuevo Fondo' },
    });
    fireEvent.change(screen.getByLabelText(/^rif/i), {
      target: { value: 'J-99999999-0' },
    });
    fireEvent.click(screen.getByRole('button', { name: /crear inversor/i }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toastSuccess).toHaveBeenCalledWith(
      expect.stringContaining('Nuevo Fondo'),
    );
  });

  it('clicking backdrop closes', () => {
    const onClose = vi.fn();
    const { container } = renderWithQuery(<InvestorCreateModal onClose={onClose} />);
    fireEvent.click(container.querySelector('[data-testid="create-modal-backdrop"]')!);
    expect(onClose).toHaveBeenCalled();
  });

  it('clicking the × close button closes', () => {
    const onClose = vi.fn();
    renderWithQuery(<InvestorCreateModal onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /^×$/ }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/investors/investor-create-modal.test.tsx
```

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/investors/investor-create-modal.tsx`:

```tsx
'use client';

import { toast } from 'sonner';
import { InvestorCreateForm } from '@/components/cert-wizard/investor-create-form';

interface Props {
  onClose: () => void;
}

export function InvestorCreateModal({ onClose }: Props) {
  return (
    <div
      data-testid="create-modal-backdrop"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-card mt-16 w-full max-w-[520px] overflow-hidden rounded-xl"
      >
        <header className="border-border-subtle flex items-start justify-between border-b px-6 py-4">
          <h2 className="text-[16px] font-semibold tracking-[-0.2px]">
            Registrar inversor
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="bg-subtle text-text-2 flex h-7 w-7 items-center justify-center rounded-md text-[14px]"
          >
            ×
          </button>
        </header>
        <div className="px-6 py-5">
          <InvestorCreateForm
            onCreated={(inv) => {
              toast.success(`Inversor ${inv.legal_name} registrado`);
              onClose();
            }}
          />
        </div>
      </div>
    </div>
  );
}
```

The wrapped `<InvestorCreateForm>` already invalidates `['investors']` on success — no duplicate logic here.

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/investors/investor-create-modal.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/investors/investor-create-modal.tsx components/investors/investor-create-modal.test.tsx
git commit -m "$(cat <<'EOF'
feat(investors): InvestorCreateModal

Thin backdrop+header wrapper around the existing InvestorCreateForm
from cert-wizard. Adds a toast on success and closes the modal.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: `<InvestorEditModal>`

**Files:**
- Create: `components/investors/investor-edit-modal.tsx`
- Create: `components/investors/investor-edit-modal.test.tsx`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/components/investors/investor-edit-modal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from '@/test/helpers/tanstack';
import { InvestorEditModal } from './investor-edit-modal';
import type { InvestorSummary } from '@/lib/types/investor';

const { mockUpdate, toastSuccess, toastError } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/lib/api/investors', () => ({
  updateInvestor: (...a: unknown[]) => mockUpdate(...a),
}));

vi.mock('sonner', () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

function inv(over: Partial<InvestorSummary> = {}): InvestorSummary {
  return {
    id: 'inv-1',
    legal_name: 'Inversora Alpha, C.A.',
    rif: 'J-12345678-9',
    kind: 'juridica',
    status: 'active',
    email: 'ops@alpha.com',
    phone: '+58-212-555-1234',
    notes: 'Cliente histórico',
    created_at: '2026-01-15T00:00:00Z',
    updated_at: '2026-05-01T10:00:00Z',
    updated_by: null,
    active_cert_count: 2,
    total_invested: '450000.0000',
    ...over,
  };
}

describe('<InvestorEditModal />', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders title with legal_name', () => {
    renderWithQuery(<InvestorEditModal investor={inv()} onClose={vi.fn()} />);
    expect(screen.getByText(/editar.*alpha/i)).toBeInTheDocument();
  });

  it('initializes inputs from the investor', () => {
    renderWithQuery(<InvestorEditModal investor={inv()} onClose={vi.fn()} />);
    expect(screen.getByLabelText(/raz[oó]n social/i)).toHaveValue('Inversora Alpha, C.A.');
    expect(screen.getByLabelText(/email/i)).toHaveValue('ops@alpha.com');
    expect(screen.getByLabelText(/tel[eé]fono/i)).toHaveValue('+58-212-555-1234');
    expect(screen.getByLabelText(/notas/i)).toHaveValue('Cliente histórico');
  });

  it('disables Guardar when no field is dirty', () => {
    renderWithQuery(<InvestorEditModal investor={inv()} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: /guardar/i })).toBeDisabled();
  });

  it('enables Guardar after a dirty change', () => {
    renderWithQuery(<InvestorEditModal investor={inv()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'new@alpha.com' },
    });
    expect(screen.getByRole('button', { name: /guardar/i })).not.toBeDisabled();
  });

  it('sends only dirty fields on submit', async () => {
    mockUpdate.mockResolvedValueOnce(inv({ email: 'new@alpha.com' }));
    const onClose = vi.fn();
    renderWithQuery(<InvestorEditModal investor={inv()} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'new@alpha.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('inv-1', { email: 'new@alpha.com' }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('toggles status via the Activo/Inactivo buttons', () => {
    renderWithQuery(<InvestorEditModal investor={inv()} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Activo' })).toHaveAttribute(
      'data-active',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Inactivo' }));
    expect(screen.getByRole('button', { name: 'Inactivo' })).toHaveAttribute(
      'data-active',
      'true',
    );
    expect(screen.getByRole('button', { name: /guardar/i })).not.toBeDisabled();
  });

  it('on error: toasts and stays open', async () => {
    mockUpdate.mockRejectedValueOnce(new Error('Conflicto de datos'));
    const onClose = vi.fn();
    renderWithQuery(<InvestorEditModal investor={inv()} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'x@y.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('clicking backdrop closes', () => {
    const onClose = vi.fn();
    const { container } = renderWithQuery(
      <InvestorEditModal investor={inv()} onClose={onClose} />,
    );
    fireEvent.click(container.querySelector('[data-testid="edit-modal-backdrop"]')!);
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/investors/investor-edit-modal.test.tsx
```

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/investors/investor-edit-modal.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { updateInvestor } from '@/lib/api/investors';
import type { InvestorStatus, InvestorSummary, InvestorUpdate } from '@/lib/types/investor';

interface Props {
  investor: InvestorSummary;
  onClose: () => void;
}

export function InvestorEditModal({ investor, onClose }: Props) {
  const [legalName, setLegalName] = useState(investor.legal_name);
  const [email, setEmail] = useState(investor.email ?? '');
  const [phone, setPhone] = useState(investor.phone ?? '');
  const [notes, setNotes] = useState(investor.notes ?? '');
  const [status, setStatus] = useState<InvestorStatus>(investor.status);
  const qc = useQueryClient();

  const mut = useMutation({
    mutationFn: (body: InvestorUpdate) => updateInvestor(investor.id, body),
    onSuccess: (inv) => {
      qc.invalidateQueries({ queryKey: ['investors'] });
      toast.success(`Inversor ${inv.legal_name} actualizado`);
      onClose();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'No se pudo actualizar');
    },
  });

  function buildDirtyPayload(): InvestorUpdate {
    const body: InvestorUpdate = {};
    const trimmedLegal = legalName.trim();
    if (trimmedLegal !== investor.legal_name) body.legal_name = trimmedLegal;
    const trimmedEmail = email.trim();
    const nextEmail = trimmedEmail === '' ? null : trimmedEmail;
    if (nextEmail !== investor.email) body.email = nextEmail;
    const trimmedPhone = phone.trim();
    const nextPhone = trimmedPhone === '' ? null : trimmedPhone;
    if (nextPhone !== investor.phone) body.phone = nextPhone;
    const trimmedNotes = notes.trim();
    const nextNotes = trimmedNotes === '' ? null : trimmedNotes;
    if (nextNotes !== investor.notes) body.notes = nextNotes;
    if (status !== investor.status) body.status = status;
    return body;
  }

  const payload = buildDirtyPayload();
  const dirty = Object.keys(payload).length > 0;
  const legalNameValid = legalName.trim().length >= 1 && legalName.trim().length <= 255;
  const emailValid = email.trim() === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const phoneValid = phone.trim() === '' || phone.trim().length <= 50;
  const notesValid = notes.length <= 1000;
  const canSubmit = dirty && legalNameValid && emailValid && phoneValid && notesValid && !mut.isPending;

  return (
    <div
      data-testid="edit-modal-backdrop"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-card mt-16 w-full max-w-[520px] overflow-hidden rounded-xl"
      >
        <header className="border-border-subtle flex items-start justify-between border-b px-6 py-4">
          <h2 className="text-[16px] font-semibold tracking-[-0.2px]">
            Editar {investor.legal_name}
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
          <Field label="Notas" id="notes">
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={1000}
              rows={3}
              className="border-border-subtle bg-card resize-none rounded-md border px-3 py-2 text-[12px]"
            />
          </Field>
          <div className="flex items-center gap-3">
            <span className="text-text-3 text-[11px]">Estado</span>
            <div className="border-border-subtle flex items-center gap-1 rounded-md border p-1">
              <button
                type="button"
                data-active={status === 'active'}
                onClick={() => setStatus('active')}
                className={
                  'rounded px-3 py-1 text-[12px] font-medium transition-colors ' +
                  (status === 'active'
                    ? 'bg-foreground text-background'
                    : 'text-text-2 hover:bg-subtle')
                }
              >
                Activo
              </button>
              <button
                type="button"
                data-active={status === 'inactive'}
                onClick={() => setStatus('inactive')}
                className={
                  'rounded px-3 py-1 text-[12px] font-medium transition-colors ' +
                  (status === 'inactive'
                    ? 'bg-foreground text-background'
                    : 'text-text-2 hover:bg-subtle')
                }
              >
                Inactivo
              </button>
            </div>
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
            onClick={() => mut.mutate(payload)}
            disabled={!canSubmit}
            className="bg-foreground text-background rounded-md px-3 py-1.5 text-[12px] font-medium disabled:opacity-40"
          >
            {mut.isPending ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </div>
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
pnpm test components/investors/investor-edit-modal.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/investors/investor-edit-modal.tsx components/investors/investor-edit-modal.test.tsx
git commit -m "$(cat <<'EOF'
feat(investors): InvestorEditModal

Form with legal_name, email, phone, notes, status. Sends only dirty
fields to PATCH /api/investors/:id (back rejects empty payloads).
Status toggle via two-button pill group.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: `<InvestorsPage>` orchestrator

**Files:**
- Create: `components/investors/investors-page.tsx`
- Create: `components/investors/investors-page.test.tsx`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/components/investors/investors-page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithQuery } from '@/test/helpers/tanstack';
import { UserProvider } from '@/lib/auth/user-context';
import { InvestorsPage } from './investors-page';
import type { InvestorSummary } from '@/lib/types/investor';

const { mockList } = vi.hoisted(() => ({ mockList: vi.fn() }));

vi.mock('@/lib/api/investors', () => ({
  listInvestors: (...a: unknown[]) => mockList(...a),
  createInvestor: vi.fn(),
  updateInvestor: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function inv(over: Partial<InvestorSummary> = {}): InvestorSummary {
  return {
    id: 'inv-1',
    legal_name: 'Alpha',
    rif: 'J-1',
    kind: 'juridica',
    status: 'active',
    email: null,
    phone: null,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    updated_by: null,
    active_cert_count: 1,
    total_invested: '100000.0000',
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

function wrap(user: typeof operator, ui: React.ReactElement) {
  return renderWithQuery(<UserProvider user={user}>{ui}</UserProvider>);
}

describe('<InvestorsPage />', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue({ data: [inv()], total: 1, limit: 50, offset: 0 });
  });

  it('renders header + metrics + filters + table for operator', async () => {
    wrap(operator, <InvestorsPage />);
    expect(
      screen.getByRole('heading', { level: 1, name: /inversores/i }),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /registrar inversor/i })).toBeInTheDocument();
  });

  it('hides Registrar inversor for auditor', async () => {
    wrap(auditor, <InvestorsPage />);
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
    expect(
      screen.queryByRole('button', { name: /registrar inversor/i }),
    ).not.toBeInTheDocument();
  });

  it('clicking a row does NOT open edit modal for auditor', async () => {
    wrap(auditor, <InvestorsPage />);
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Alpha'));
    expect(screen.queryByText(/editar alpha/i)).not.toBeInTheDocument();
  });

  it('clicking a row opens the edit modal for operator', async () => {
    wrap(operator, <InvestorsPage />);
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Alpha'));
    expect(screen.getByText(/editar alpha/i)).toBeInTheDocument();
  });

  it('clicking Registrar opens the create modal', async () => {
    wrap(operator, <InvestorsPage />);
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /registrar inversor/i }));
    expect(screen.getByText(/registrar inversor/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/investors/investors-page.test.tsx
```

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/investors/investors-page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { hasPermission } from '@/lib/permissions/has-permission';
import { useUser } from '@/lib/auth/user-context';
import type { InvestorSummary } from '@/lib/types/investor';
import {
  InvestorsFilters,
  type InvestorsFiltersValue,
} from './investors-filters';
import { InvestorsTable } from './investors-table';
import { InvestorMetricsStrip } from './investor-metrics-strip';
import { InvestorCreateModal } from './investor-create-modal';
import { InvestorEditModal } from './investor-edit-modal';

const INITIAL_FILTERS: InvestorsFiltersValue = {
  status: 'active',
  q: '',
};

export function InvestorsPage() {
  const user = useUser();
  const canCreate = hasPermission(user.role, 'investor.create');
  const canEdit = hasPermission(user.role, 'investor.update');

  const [filters, setFiltersInternal] = useState<InvestorsFiltersValue>(INITIAL_FILTERS);
  const [page, setPage] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<InvestorSummary | null>(null);

  function setFilters(next: InvestorsFiltersValue) {
    setFiltersInternal(next);
    setPage(0);
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] px-9 py-7">
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          breadcrumb={{ section: 'Operación', current: 'Inversores' }}
          title="Inversores"
        />
        {canCreate && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="bg-foreground text-background rounded-md px-4 py-2 text-[12px] font-medium"
          >
            Registrar inversor
          </button>
        )}
      </div>
      <div className="mt-6 flex flex-col gap-6">
        <InvestorMetricsStrip filters={filters} page={page} />
        <InvestorsFilters value={filters} onChange={setFilters} />
        <InvestorsTable
          filters={filters}
          page={page}
          onPageChange={setPage}
          onEditInvestor={canEdit ? setEditTarget : undefined}
        />
      </div>
      {createOpen && <InvestorCreateModal onClose={() => setCreateOpen(false)} />}
      {editTarget && (
        <InvestorEditModal
          investor={editTarget}
          onClose={() => setEditTarget(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/investors/investors-page.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/investors/investors-page.tsx components/investors/investors-page.test.tsx
git commit -m "$(cat <<'EOF'
feat(investors): InvestorsPage orchestrator

Owns filter + page + modal state. Gates Registrar button on
investor.create permission. Gates edit-on-click on investor.update.
Auditor sees the list read-only.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Wire `/investors` route

**Files:**
- Modify: `app/(app)/investors/page.tsx`

- [ ] **Step 1: Replace the route file**

Overwrite `/Users/llam/dev/araguaney_front/app/(app)/investors/page.tsx` with:

```tsx
import { InvestorsPage } from '@/components/investors/investors-page';

export default function InvestorsRoute() {
  return <InvestorsPage />;
}
```

- [ ] **Step 2: Verify + build**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
pnpm build
```

Expected: build succeeds; `/investors` listed as `ƒ` (dynamic) in the route manifest.

If `pnpm build` fails, report BLOCKED with the error.

- [ ] **Step 3: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add "app/(app)/investors/page.tsx"
git commit -m "$(cat <<'EOF'
feat(investors): wire /investors route

Replaces the Slice 1 ComingSoon stub. Server Component shell mounts
the client orchestrator.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Local smoke + visual sanity

**Files:** none (verification only).

- [ ] **Step 1: Boot dev**

```bash
cd /Users/llam/dev/araguaney_front
lsof -ti:3000 | xargs kill -9 2>/dev/null
pnpm dev > /tmp/front-task13.log 2>&1 &
PID=$!
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if grep -q "Ready in" /tmp/front-task13.log 2>/dev/null; then echo "ready in ${i}s"; break; fi
  sleep 1
done
```

- [ ] **Step 2: Verify route gating**

```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3000/investors
```

Expected: `307` redirect to `/login`.

- [ ] **Step 3: Visual smoke (manual, for the user post-deploy)**

Document the steps so the user can replay after Vercel preview deploys:

1. Login as operator → sidebar → **Inversores**.
2. Lista renderiza con los inversores existentes (NO Cashea / `kind=internal`).
3. Metric strip muestra activos + capital colocado correctos.
4. Click pill "Todos" → muestra activos + inactivos. Click "Inactivos" → solo inactivos.
5. Buscar por RIF o razón social → la lista filtra después de 300ms.
6. Click una row → modal "Editar X" abre con campos pre-llenados.
7. Cambiar email → "Guardar cambios" se activa. Click → toast verde, modal cierra, lista refleja cambio.
8. Click "Registrar inversor" → modal con form vacío. Llenar razón social + RIF + tipo → Crear → toast verde, modal cierra, lista incluye al nuevo.
9. Logout, login como auditor → /investors → la lista carga. NO ve el botón "Registrar". Click row no hace nada (cursor default).

- [ ] **Step 4: Stop dev**

```bash
kill $PID; wait $PID 2>/dev/null
```

- [ ] **Step 5: No commit**

---

## Task 14: Push branch + open PR

**Files:** none.

- [ ] **Step 1: Push**

```bash
cd /Users/llam/dev/araguaney_front
git push -u origin feat/slice-6-investors
```

- [ ] **Step 2: Open PR**

```bash
cd /Users/llam/dev/araguaney_front
gh pr create --title "feat: Slice 6 — /investors CRUD" --body "$(cat <<'EOF'
## Summary

Cierra el loop de gestión de inversores fuera del wizard.

- `/investors` con lista paginada + filtros (3 pills status, búsqueda razón social/RIF debounced)
- 2 metric cards (Activos, Capital colocado) calculadas sobre la página actual
- Botón **Registrar inversor** (gated en `investor.create`) → modal con `<InvestorCreateForm>` reusado del wizard
- Click row → modal **Editar** (gated en `investor.update`) → PATCH /api/investors/:id con solo los campos modificados
- Auditor ve la lista en read-only
- `kind='internal'` (Cashea) filtrado del listado

## Foundation cleanup

- Reemplaza el permission key dead `investor.write` por los dos del back (`investor.create` + `investor.update`)
- Extiende `InvestorSummary` con `notes`, `created_at`, `updated_at`, `updated_by`, `active_cert_count`, `total_invested`
- Agrega `updateInvestor` Server Action

## What's new

- `lib/types/investor.ts` — extiende tipos al wire shape completo
- `lib/api/investors.ts` — `updateInvestor` PATCH
- `lib/permissions/has-permission.ts` — split investor.write
- 8 componentes nuevos en `components/investors/`
- `app/(app)/investors/page.tsx` (modify)

## Test Plan

- [x] `pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check && pnpm build` — todo clean
- [x] ~32 nuevos tests pasando
- [ ] Vercel preview deploy renders sin console errors
- [ ] Flow end-to-end: list → registrar → editar → status toggle
- [ ] Auditor no ve botón Registrar ni puede abrir edit

## Notes

- No detail page de inversor (out of scope)
- No columnas `avg_rate` ni `last_issued_date` (back no las expone hoy)
- Métricas son page-scoped — back stats endpoint pendiente para globales
- `kind='internal'` filtrado client-side hasta que el back acepte `exclude_internal=true`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

If `gh` fails on "must be a collaborator", surface the URL and skip step 3.

- [ ] **Step 3: Watch CI**

```bash
until gh run list --repo armandogois-lab/araguaney_front --limit 1 --json status -q '.[0].status' | grep -q completed; do sleep 5; done
gh run list --repo armandogois-lab/araguaney_front --limit 1
```

Expected: green ✓.

---

## Summary

**What's new (front):**

- New route `/investors` with list, filters, metrics, register, edit.
- 8 new components in `components/investors/` (+ tests for each).
- `updateInvestor` API extension.
- Full `InvestorSummary` wire shape exposed to the front.
- Permission keys aligned with back (`investor.create`, `investor.update`).

**Test Plan**

- [x] `pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check && pnpm build` — todo clean
- [x] ~32 nuevos tests pasando

**Notes**

- No detail page (`/investors/[id]`) — out of scope this slice.
- Sin métricas globales — back stats endpoint pendiente.
- `kind='internal'` filtrado client-side — back filter futuro.

---

## Self-Review

**Spec coverage:**

- ✅ List page con paginación + filtros — Tasks 5-7
- ✅ 2-card metrics strip — Task 8
- ✅ "Registrar inversor" modal reusando InvestorCreateForm — Task 9
- ✅ Edit modal con PATCH + dirty-only payload — Task 10
- ✅ Permission gating operator/admin vs auditor — Task 11
- ✅ Foundation cleanup `investor.write` → `create`/`update` — Task 1
- ✅ Extensión de tipos `InvestorSummary` + `InvestorUpdate` — Task 2
- ✅ Server Action `updateInvestor` — Task 3
- ✅ Filtro client-side de `kind='internal'` — Task 7
- ✅ Smoke + PR — Tasks 13-14

**Placeholder scan:** No `TODO`/`TBD`/`fill in`. Step 3 of Task 13 is documentation for the user-driven smoke flow post-deploy, not implementation placeholder.

**Type consistency:**
- `InvestorSummary` (Task 2) consumed by row (Task 5), table (Task 7), metrics (Task 8), edit modal (Task 10), orchestrator (Task 11).
- `InvestorUpdate` (Task 2) consumed by API (Task 3) and edit modal (Task 10).
- `InvestorsFiltersValue` (Task 6) consumed by table (Task 7), metrics (Task 8), orchestrator (Task 11).
- `buildQuery` exported from table (Task 7) and re-used by metrics strip (Task 8) to match cache key.
- Permission keys `investor.create` / `investor.update` (Task 1) consumed by orchestrator (Task 11).

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-11-front-slice-6-investors-crud.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Fresh subagent per task + two-stage review.

**2. Inline Execution** — Same session with batch checkpoints.

**Which approach?**
