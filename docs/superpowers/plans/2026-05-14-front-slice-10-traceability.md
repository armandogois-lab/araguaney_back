# araguaney_front Slice 10 — `/traceability` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/traceability` chain view — paginated list of certificates with lazy-expand of their orders, plus a sticky inspector showing the audit chain (Orden → Certificado → Inversor → Emitido por) and the cert's payload_hash.

**Architecture:** One route at `/traceability` with a Server Component shell mounting `<TraceabilityPage>` client orchestrator. Single top-level cert-list query; per-cert detail fetched lazily on expand (cache key shared with Slice 5). Inspector reads `payload_hash` synchronously from the TanStack cache (always populated by the expand action that preceded it).

**Tech Stack:** Next.js 16 App Router, TanStack Query v5, hand-typed shapes, Vitest + Testing Library.

**Spec:** `/Users/llam/dev/araguaney_back/docs/superpowers/specs/2026-05-14-front-slice-10-traceability-design.md`

**Working directory note:** all front code lives in `/Users/llam/dev/araguaney_front/`. Plan and spec live in `/Users/llam/dev/araguaney_back/docs/`. Implementer must `cd /Users/llam/dev/araguaney_front` for any task command.

**Pre-req branch:** Work on `feat/slice-10-traceability` (Task 1 creates this from `main`).

**Pre-flight finding — no `batch_id` on CertificateOrder.** The Slice 5 type `CertificateOrder` does not include the order's `batch_id`. The order row therefore drops the "Lote" column, and the inspector drops the "LOTE" step (4 steps instead of 5). This is a known v1 limitation documented in the spec's Out-of-scope follow-ups.

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `lib/traceability/filter.ts` (+ test) | create | Pure `filterCertsBySearch(certs, query)` — testable independent of UI |
| `components/traceability/trace-kpi-strip.tsx` (+ test) | create | 3 cards: Certs, Inversores con cobertura, Usuarios emisores |
| `components/traceability/trace-toolbar.tsx` (+ test) | create | Debounced search + 2 date inputs |
| `components/traceability/trace-cert-row.tsx` (+ test) | create | Cert header row with chevron + click toggles expansion |
| `components/traceability/trace-cert-orders.tsx` (+ test) | create | Lazy-loaded body: `useQuery(['certificate', id])` when enabled |
| `components/traceability/trace-cert-card.tsx` (+ test) | create | Wraps row + orders |
| `components/traceability/trace-inspector.tsx` (+ test) | create | Sticky panel: 4 vertical steps + hash |
| `components/traceability/traceability-page.tsx` (+ test) | create | Orchestrator |
| `app/(app)/traceability/page.tsx` | modify | Replace ComingSoon |

**Total:** 16 new files + 1 modification. ~28 new tests.

**Manual operational tasks:**

| Action | Owner | When |
|---|---|---|
| Push branch + open PR | controller | Task 10 |
| Review + merge | user | After Task 10 |
| Verify Vercel deploy + visual smoke | user | Post-merge |

---

## Task 1: Branch + `filterCertsBySearch` helper

**Why:** Pure function isolated from React. Keeps the orchestrator simpler and the search logic individually testable.

**Files:**
- Create: `lib/traceability/filter.ts`
- Create: `lib/traceability/filter.test.ts`

- [ ] **Step 1: Create branch from main**

```bash
cd /Users/llam/dev/araguaney_front
git fetch origin --prune
git checkout main
git pull origin main
git checkout -b feat/slice-10-traceability
```

- [ ] **Step 2: Failing tests**

```bash
cd /Users/llam/dev/araguaney_front
mkdir -p lib/traceability components/traceability
```

Create `/Users/llam/dev/araguaney_front/lib/traceability/filter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { filterCertsBySearch } from './filter';
import type { CertificateSummary } from '@/lib/types/certificate';

function cert(over: Partial<CertificateSummary> = {}): CertificateSummary {
  return {
    id: 'c-' + Math.random(),
    certificate_code: 'C4572A',
    certificate_type: 'standard',
    status: 'issued',
    investor: { id: 'inv-1', legal_name: 'Inversora Alpha, C.A.', rif: 'J-12345678-9' },
    investor_capital: '100000.0000',
    annual_rate: '0.130000',
    term_days: 42,
    price: '0.985060',
    nominal_target: '101516.6589',
    nominal_actual: '101516.0000',
    investor_paid: '99999.3510',
    investor_yield: '1516.6490',
    shortfall_pct: '0.000006',
    issue_date: '2026-04-27',
    maturity_date: '2026-06-08',
    cycle_week: '2026-W17',
    issued_by: { id: 'u-1', email: 'maria@cashea.app', full_name: 'María Rodríguez' },
    created_at: '2026-04-27T14:30:00Z',
    ...over,
  };
}

describe('filterCertsBySearch', () => {
  it('empty query returns all certs with mode "all"', () => {
    const certs = [cert({ id: 'c-1' }), cert({ id: 'c-2' })];
    const r = filterCertsBySearch(certs, '');
    expect(r).toHaveLength(2);
    expect(r.every((x) => x.mode === 'all')).toBe(true);
  });

  it('matches on certificate_code (case-insensitive)', () => {
    const certs = [cert({ id: 'c-1', certificate_code: 'C4572A' }), cert({ id: 'c-2', certificate_code: 'C9999X' })];
    const r = filterCertsBySearch(certs, 'c4572');
    expect(r).toHaveLength(1);
    expect(r[0].cert.id).toBe('c-1');
    expect(r[0].mode).toBe('match-cert');
  });

  it('matches on investor legal_name', () => {
    const certs = [cert({ id: 'c-1', investor: { id: 'i-1', legal_name: 'Inversora Alpha', rif: 'J-1' } }), cert({ id: 'c-2', investor: { id: 'i-2', legal_name: 'Otro Fondo', rif: 'J-2' } })];
    const r = filterCertsBySearch(certs, 'alpha');
    expect(r).toHaveLength(1);
    expect(r[0].cert.id).toBe('c-1');
  });

  it('matches on investor rif', () => {
    const certs = [cert({ id: 'c-1', investor: { id: 'i-1', legal_name: 'A', rif: 'J-12345678-9' } })];
    const r = filterCertsBySearch(certs, '12345678');
    expect(r).toHaveLength(1);
    expect(r[0].cert.id).toBe('c-1');
  });

  it('matches on issued_by full_name', () => {
    const certs = [cert({ id: 'c-1', issued_by: { id: 'u-1', email: 'maria@x.com', full_name: 'María Rodríguez' } })];
    const r = filterCertsBySearch(certs, 'maría');
    expect(r).toHaveLength(1);
  });

  it('drops certs with no match', () => {
    const certs = [cert({ id: 'c-1', certificate_code: 'C0001A' }), cert({ id: 'c-2', certificate_code: 'C0002B' })];
    const r = filterCertsBySearch(certs, 'xxxnomatchxxx');
    expect(r).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/traceability/filter.test.ts
```

Expected: import error — module doesn't exist.

- [ ] **Step 4: Implement**

Create `/Users/llam/dev/araguaney_front/lib/traceability/filter.ts`:

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
  if (!q) return certs.map((cert) => ({ cert, mode: 'all' as const }));
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

- [ ] **Step 5: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/traceability/filter.test.ts
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 6: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add lib/traceability/filter.ts lib/traceability/filter.test.ts
git commit -m "$(cat <<'EOF'
feat(traceability): filterCertsBySearch helper

Pure function classifying certs by query match against
certificate_code, investor legal_name + rif, and issued_by full_name.
Case-insensitive. Returns { cert, mode } pairs where mode is 'all'
(empty query) or 'match-cert'.

Order-level matching is out of scope for v1 (would require expanded
detail data).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `<TraceKpiStrip>`

**Files:**
- Create: `components/traceability/trace-kpi-strip.tsx`
- Create: `components/traceability/trace-kpi-strip.test.tsx`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/components/traceability/trace-kpi-strip.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { UseQueryResult } from '@tanstack/react-query';
import { TraceKpiStrip } from './trace-kpi-strip';
import type { CertificateSummary, CertificatesListResponse } from '@/lib/types/certificate';

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
    price: '0.985060',
    nominal_target: '101516.6589',
    nominal_actual: '101516.0000',
    investor_paid: '99999.3510',
    investor_yield: '1516.6490',
    shortfall_pct: '0.000006',
    issue_date: '2026-04-27',
    maturity_date: '2026-06-08',
    cycle_week: '2026-W17',
    issued_by: { id: 'u-1', email: 'maria@x.com', full_name: 'María R.' },
    created_at: '2026-04-27T14:30:00Z',
    ...over,
  };
}

function q(
  data?: CertificatesListResponse,
  over: Partial<UseQueryResult<CertificatesListResponse>> = {},
) {
  return {
    data,
    isLoading: false,
    isError: false,
    ...over,
  } as UseQueryResult<CertificatesListResponse>;
}

describe('<TraceKpiStrip />', () => {
  it('renders 3 cards with computed values', () => {
    const data: CertificatesListResponse = {
      data: [
        cert({ investor: { id: 'inv-1', legal_name: 'A', rif: 'J-1' }, issued_by: { id: 'u-1', email: 'm@x', full_name: 'María R.' } }),
        cert({ investor: { id: 'inv-2', legal_name: 'B', rif: 'J-2' }, issued_by: { id: 'u-2', email: 'p@x', full_name: 'Pedro S.' } }),
        cert({ investor: { id: 'inv-1', legal_name: 'A', rif: 'J-1' }, issued_by: { id: 'u-1', email: 'm@x', full_name: 'María R.' } }),
      ],
      total: 12,
      limit: 100,
      offset: 0,
    };
    render(<TraceKpiStrip certsQ={q(data)} />);
    expect(screen.getByText('Certificados emitidos')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Inversores con cobertura')).toBeInTheDocument();
    // 2 distinct investors in the sample
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Usuarios emisores')).toBeInTheDocument();
    expect(screen.getByText(/María R\. · Pedro S\./)).toBeInTheDocument();
  });

  it('all zero when list is empty', () => {
    const empty: CertificatesListResponse = { data: [], total: 0, limit: 100, offset: 0 };
    render(<TraceKpiStrip certsQ={q(empty)} />);
    // Three zero values
    const zeros = screen.getAllByText('0');
    expect(zeros.length).toBeGreaterThanOrEqual(3);
  });

  it('shows loading skeleton when isLoading', () => {
    render(<TraceKpiStrip certsQ={q(undefined, { isLoading: true })} />);
    expect(screen.getAllByText(/cargando/i).length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/traceability/trace-kpi-strip.test.tsx
```

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/traceability/trace-kpi-strip.tsx`:

```tsx
'use client';

import type { UseQueryResult } from '@tanstack/react-query';
import type { CertificatesListResponse } from '@/lib/types/certificate';

interface Props {
  certsQ: UseQueryResult<CertificatesListResponse>;
}

export function TraceKpiStrip({ certsQ }: Props) {
  if (certsQ.isLoading) {
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <CardSkeleton label="Certificados emitidos" />
        <CardSkeleton label="Inversores con cobertura" />
        <CardSkeleton label="Usuarios emisores" />
      </div>
    );
  }
  if (certsQ.isError || !certsQ.data) {
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <CardError label="Certificados emitidos" />
        <CardError label="Inversores con cobertura" />
        <CardError label="Usuarios emisores" />
      </div>
    );
  }
  const certs = certsQ.data.data;
  const investors = new Set(certs.map((c) => c.investor.id));
  const emisores = Array.from(new Set(certs.map((c) => c.issued_by.full_name)));
  const emisoresSub =
    emisores.length === 0
      ? 'sin emisores'
      : emisores.slice(0, 2).join(' · ') + (emisores.length > 2 ? ' · …' : '');

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <Card label="Certificados emitidos" value={String(certsQ.data.total)} sub="en el período" />
      <Card
        label="Inversores con cobertura"
        value={String(investors.size)}
        sub="únicos con orden asignada"
      />
      <Card label="Usuarios emisores" value={String(emisores.length)} sub={emisoresSub} />
    </div>
  );
}

function Card({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-card border-border-subtle rounded-xl border p-5">
      <div className="text-text-3 mb-1 text-[10px] uppercase tracking-wide">{label}</div>
      <div className="text-[20px] font-semibold tabular-nums tracking-[-0.3px]">{value}</div>
      <div className="text-text-3 mt-0.5 text-[11px] tabular-nums">{sub}</div>
    </div>
  );
}

function CardSkeleton({ label }: { label: string }) {
  return (
    <div className="bg-card border-border-subtle rounded-xl border p-5">
      <div className="text-text-3 mb-1 text-[10px] uppercase tracking-wide">{label}</div>
      <div className="text-text-3 text-[12px] italic">Cargando…</div>
    </div>
  );
}

function CardError({ label }: { label: string }) {
  return (
    <div className="bg-card border-border-subtle rounded-xl border p-5">
      <div className="text-text-3 mb-1 text-[10px] uppercase tracking-wide">{label}</div>
      <div className="text-warn-text text-[12px]">No se pudo cargar.</div>
    </div>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/traceability/trace-kpi-strip.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/traceability/trace-kpi-strip.tsx components/traceability/trace-kpi-strip.test.tsx
git commit -m "$(cat <<'EOF'
feat(traceability): TraceKpiStrip

3 cards: Certificados (total from response), Inversores con cobertura
(distinct investor.id), Usuarios emisores (distinct issued_by + first
2 names as sub). Each card has loading/error states.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `<TraceToolbar>`

**Files:**
- Create: `components/traceability/trace-toolbar.tsx`
- Create: `components/traceability/trace-toolbar.test.tsx`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/components/traceability/trace-toolbar.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TraceToolbar, type TraceFiltersValue } from './trace-toolbar';

const DEFAULT: TraceFiltersValue = {
  q: '',
  dateFrom: '2026-04-14',
  dateTo: '2026-05-14',
};

describe('<TraceToolbar />', () => {
  it('renders search input + 2 date inputs with default values', () => {
    render(<TraceToolbar value={DEFAULT} onChange={() => {}} />);
    expect(screen.getByPlaceholderText(/c[oó]digo, inversor/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/desde/i)).toHaveValue('2026-04-14');
    expect(screen.getByLabelText(/hasta/i)).toHaveValue('2026-05-14');
  });

  it('debounces search by 300ms', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<TraceToolbar value={DEFAULT} onChange={onChange} />);
    const input = screen.getByPlaceholderText(/c[oó]digo, inversor/i);
    fireEvent.change(input, { target: { value: 'Alpha' } });
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(310);
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT, q: 'Alpha' });
    vi.useRealTimers();
  });

  it('emits dateFrom change immediately', () => {
    const onChange = vi.fn();
    render(<TraceToolbar value={DEFAULT} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/desde/i), { target: { value: '2026-05-01' } });
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT, dateFrom: '2026-05-01' });
  });

  it('emits dateTo change immediately', () => {
    const onChange = vi.fn();
    render(<TraceToolbar value={DEFAULT} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/hasta/i), { target: { value: '2026-05-31' } });
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT, dateTo: '2026-05-31' });
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/traceability/trace-toolbar.test.tsx
```

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/traceability/trace-toolbar.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';

export interface TraceFiltersValue {
  q: string;
  dateFrom: string;
  dateTo: string;
}

interface Props {
  value: TraceFiltersValue;
  onChange: (next: TraceFiltersValue) => void;
}

export function TraceToolbar({ value, onChange }: Props) {
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
    <div className="bg-card border-border-subtle flex flex-wrap items-center gap-2 rounded-xl border px-4 py-3">
      <input
        type="search"
        placeholder="🔎 Código, inversor, RIF o usuario emisor"
        value={qLocal}
        onChange={(e) => setQLocal(e.target.value)}
        className="border-border-subtle bg-card flex-1 rounded-md border px-3 py-1.5 text-[12px]"
      />
      <label className="flex items-center gap-2 text-[11px]">
        <span className="text-text-3">Desde</span>
        <input
          type="date"
          aria-label="Desde"
          value={value.dateFrom}
          onChange={(e) => onChange({ ...value, dateFrom: e.target.value })}
          className="border-border-subtle bg-card rounded-md border px-2 py-1 text-[12px]"
        />
      </label>
      <label className="flex items-center gap-2 text-[11px]">
        <span className="text-text-3">Hasta</span>
        <input
          type="date"
          aria-label="Hasta"
          value={value.dateTo}
          onChange={(e) => onChange({ ...value, dateTo: e.target.value })}
          className="border-border-subtle bg-card rounded-md border px-2 py-1 text-[12px]"
        />
      </label>
    </div>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/traceability/trace-toolbar.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/traceability/trace-toolbar.tsx components/traceability/trace-toolbar.test.tsx
git commit -m "$(cat <<'EOF'
feat(traceability): TraceToolbar

Search input (debounced 300ms) + 2 date inputs. Stateless except for
search debounce; parent owns the value.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `<TraceCertRow>`

**Files:**
- Create: `components/traceability/trace-cert-row.tsx`
- Create: `components/traceability/trace-cert-row.test.tsx`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/components/traceability/trace-cert-row.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TraceCertRow } from './trace-cert-row';
import type { CertificateSummary } from '@/lib/types/certificate';

function cert(over: Partial<CertificateSummary> = {}): CertificateSummary {
  return {
    id: 'cert-1',
    certificate_code: 'C4572A',
    certificate_type: 'standard',
    status: 'issued',
    investor: { id: 'inv-1', legal_name: 'Inversora Alpha', rif: 'J-12345678-9' },
    investor_capital: '100000.0000',
    annual_rate: '0.130000',
    term_days: 42,
    price: '0.985060',
    nominal_target: '101516.6589',
    nominal_actual: '101516.0000',
    investor_paid: '99999.3510',
    investor_yield: '1516.6490',
    shortfall_pct: '0.000006',
    issue_date: '2026-04-27',
    maturity_date: '2026-06-08',
    cycle_week: '2026-W17',
    issued_by: { id: 'u-1', email: 'maria@x.com', full_name: 'María Rodríguez' },
    created_at: '2026-04-27T14:30:00Z',
    ...over,
  };
}

describe('<TraceCertRow />', () => {
  it('renders code + capital + term @ rate + investor + emitted by + maturity + status pill', () => {
    render(<TraceCertRow cert={cert()} expanded={false} onToggle={vi.fn()} />);
    expect(screen.getByText('C4572A')).toBeInTheDocument();
    expect(screen.getByText(/\$100,000\.00.*42d.*13/)).toBeInTheDocument();
    expect(screen.getByText('Inversora Alpha')).toBeInTheDocument();
    expect(screen.getByText('J-12345678-9')).toBeInTheDocument();
    expect(screen.getByText('María Rodríguez')).toBeInTheDocument();
    expect(screen.getByText('08/06/2026')).toBeInTheDocument();
    expect(screen.getByText('Activo')).toBeInTheDocument();
  });

  it('click fires onToggle with the cert id', () => {
    const onToggle = vi.fn();
    render(<TraceCertRow cert={cert()} expanded={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByText('C4572A'));
    expect(onToggle).toHaveBeenCalledWith('cert-1');
  });

  it('shows sweep pill for sweep certs', () => {
    render(<TraceCertRow cert={cert({ certificate_type: 'sweep' })} expanded={false} onToggle={vi.fn()} />);
    expect(screen.getByText('Barrido Cashea')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/traceability/trace-cert-row.test.tsx
```

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/traceability/trace-cert-row.tsx`:

```tsx
'use client';

import { Pill } from '@/components/ui/pill';
import { CertificateStatusPill } from '@/components/certificates/certificate-status-pill';
import { fmtDate } from '@/lib/format/date';
import { fmtMoney2 } from '@/lib/format/money';
import { fmtPct } from '@/lib/format/percent';
import type { CertificateSummary } from '@/lib/types/certificate';

interface Props {
  cert: CertificateSummary;
  expanded: boolean;
  onToggle: (certId: string) => void;
}

export function TraceCertRow({ cert, expanded, onToggle }: Props) {
  return (
    <div
      onClick={() => onToggle(cert.id)}
      className={
        'grid cursor-pointer items-center gap-4 px-5 py-3.5 ' +
        'grid-cols-[18px_1.2fr_1.6fr_1fr_1fr_100px] ' +
        (expanded
          ? 'bg-subtle border-border-subtle border-b'
          : 'bg-transparent hover:bg-subtle')
      }
    >
      <span
        className="text-text-3 inline-block font-mono text-[10px] transition-transform"
        style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
      >
        ▸
      </span>
      <div>
        <div className="text-text-2 font-mono text-[12px] font-medium">{cert.certificate_code}</div>
        <div className="text-text-3 mt-0.5 text-[10px] tabular-nums">
          {fmtMoney2(Number(cert.investor_capital))} · {cert.term_days}d @ {fmtPct(cert.annual_rate)}
        </div>
      </div>
      <div>
        <div className="text-text-3 mb-0.5 text-[11px]">Inversor</div>
        <div className="text-[12px] font-medium">{cert.investor.legal_name}</div>
        <div className="text-text-3 font-mono text-[10px]">{cert.investor.rif}</div>
      </div>
      <div>
        <div className="text-text-3 mb-0.5 text-[11px]">Emitido por</div>
        <div className="text-[12px]">{cert.issued_by.full_name}</div>
        <div className="text-text-3 text-[10px] tabular-nums">{fmtDate(cert.issue_date)}</div>
      </div>
      <div>
        <div className="text-text-3 mb-0.5 text-[11px]">Vencimiento</div>
        <div className="text-[12px] tabular-nums">{fmtDate(cert.maturity_date)}</div>
      </div>
      <div className="text-right">
        {cert.certificate_type === 'sweep' ? (
          <Pill variant="sweep">Barrido Cashea</Pill>
        ) : (
          <CertificateStatusPill status={cert.status} />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/traceability/trace-cert-row.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/traceability/trace-cert-row.tsx components/traceability/trace-cert-row.test.tsx
git commit -m "$(cat <<'EOF'
feat(traceability): TraceCertRow

Header row of a cert card: chevron + code+stats + investor + emitido
por + vencimiento + status pill. Click toggles expansion. Sweep certs
get the sweep variant pill.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `<TraceCertOrders>`

**Why:** Lazy-fetches the cert detail when expanded. Renders the order rows with tree connectors.

**Files:**
- Create: `components/traceability/trace-cert-orders.tsx`
- Create: `components/traceability/trace-cert-orders.test.tsx`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/components/traceability/trace-cert-orders.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithQuery } from '@/test/helpers/tanstack';
import { TraceCertOrders } from './trace-cert-orders';
import type { CertificateSummary, CertificateDetail } from '@/lib/types/certificate';

const { mockDetail } = vi.hoisted(() => ({ mockDetail: vi.fn() }));

vi.mock('@/lib/api/certificates', () => ({
  getCertificateDetail: (...a: unknown[]) => mockDetail(...a),
}));

function cert(over: Partial<CertificateSummary> = {}): CertificateSummary {
  return {
    id: 'cert-1',
    certificate_code: 'C4572A',
    certificate_type: 'standard',
    status: 'issued',
    investor: { id: 'inv-1', legal_name: 'Alpha', rif: 'J-1' },
    investor_capital: '100000.0000',
    annual_rate: '0.130000',
    term_days: 42,
    price: '0.985060',
    nominal_target: '101516.6589',
    nominal_actual: '101516.0000',
    investor_paid: '99999.3510',
    investor_yield: '1516.6490',
    shortfall_pct: '0.000006',
    issue_date: '2026-04-27',
    maturity_date: '2026-06-08',
    cycle_week: '2026-W17',
    issued_by: { id: 'u-1', email: 'op@x.com', full_name: 'Op' },
    created_at: '2026-04-27T14:30:00Z',
    ...over,
  };
}

function detail(): CertificateDetail {
  return {
    ...cert(),
    investor_returned: '0.6490',
    payload_hash: 'sha-abc',
    cancellation: null,
    orders: [
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
    ],
    events: [],
  };
}

describe('<TraceCertOrders />', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders nothing when enabled=false', () => {
    const { container } = renderWithQuery(
      <TraceCertOrders cert={cert()} enabled={false} onSelectOrder={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
    expect(mockDetail).not.toHaveBeenCalled();
  });

  it('shows skeleton while loading', () => {
    mockDetail.mockImplementation(() => new Promise(() => {}));
    renderWithQuery(<TraceCertOrders cert={cert()} enabled={true} onSelectOrder={vi.fn()} />);
    expect(screen.getByText(/cargando [oó]rdenes/i)).toBeInTheDocument();
  });

  it('renders order rows after fetch', async () => {
    mockDetail.mockResolvedValueOnce(detail());
    renderWithQuery(<TraceCertOrders cert={cert()} enabled={true} onSelectOrder={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('85657474')).toBeInTheDocument());
    expect(screen.getByText('CENTRAL MADEIRENSE')).toBeInTheDocument();
    expect(screen.getByText('3c')).toBeInTheDocument();
    expect(screen.getByText('$87.24')).toBeInTheDocument();
  });

  it('click order row fires onSelectOrder', async () => {
    mockDetail.mockResolvedValueOnce(detail());
    const onSelectOrder = vi.fn();
    renderWithQuery(
      <TraceCertOrders cert={cert()} enabled={true} onSelectOrder={onSelectOrder} />,
    );
    await waitFor(() => expect(screen.getByText('85657474')).toBeInTheDocument());
    fireEvent.click(screen.getByText('85657474'));
    expect(onSelectOrder).toHaveBeenCalledTimes(1);
    const [orderArg, certArg] = onSelectOrder.mock.calls[0];
    expect(orderArg.external_order_id).toBe('85657474');
    expect(certArg.id).toBe('cert-1');
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/traceability/trace-cert-orders.test.tsx
```

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/traceability/trace-cert-orders.tsx`:

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { getCertificateDetail } from '@/lib/api/certificates';
import { fmtMoney2 } from '@/lib/format/money';
import { Pill } from '@/components/ui/pill';
import type {
  CertificateOrder,
  CertificateSummary,
} from '@/lib/types/certificate';

interface Props {
  cert: CertificateSummary;
  enabled: boolean;
  onSelectOrder: (order: CertificateOrder, cert: CertificateSummary) => void;
}

const VISIBLE_LIMIT = 10;

export function TraceCertOrders({ cert, enabled, onSelectOrder }: Props) {
  const detailQ = useQuery({
    queryKey: ['certificate', cert.id],
    queryFn: () => getCertificateDetail(cert.id),
    staleTime: 30_000,
    enabled,
  });

  if (!enabled) return null;
  if (detailQ.isLoading)
    return <div className="text-text-3 px-9 py-4 text-[12px]">Cargando órdenes…</div>;
  if (detailQ.isError || !detailQ.data)
    return (
      <div className="px-9 py-4">
        <span className="text-warn-text text-[12px]">No se pudieron cargar las órdenes. </span>
        <button
          type="button"
          onClick={() => detailQ.refetch()}
          className="text-text-2 text-[12px] underline hover:no-underline"
        >
          Reintentar
        </button>
      </div>
    );

  const orders = detailQ.data.orders;
  const visible = orders.slice(0, VISIBLE_LIMIT);
  const remaining = orders.length - visible.length;

  return (
    <div className="relative px-9 py-1">
      {visible.map((o, i) => {
        const isLast = i === visible.length - 1;
        return (
          <div
            key={o.id}
            onClick={() => onSelectOrder(o, cert)}
            className="relative grid cursor-pointer items-center gap-3 rounded-md px-3 py-2 hover:bg-subtle grid-cols-[1fr_1.6fr_60px_90px]"
          >
            <span
              className="bg-border-strong absolute top-0 left-0 w-px"
              style={{ bottom: isLast ? '50%' : 0 }}
            />
            <span className="bg-border-strong absolute top-1/2 left-0 h-px w-2.5" />
            <div className="text-text-2 font-mono text-[11.5px]">{o.external_order_id}</div>
            <div
              className="truncate text-[11.5px]"
              title={o.merchant.current_name}
            >
              {o.merchant.current_name}
            </div>
            <div className="text-center">
              <Pill variant="neutral">{o.installments.length}c</Pill>
            </div>
            <div className="num text-right text-[11.5px]">
              {fmtMoney2(Number(o.installments_sum_snapshot))}
            </div>
          </div>
        );
      })}
      {remaining > 0 && (
        <div className="text-text-3 px-3 py-2 text-[11px] italic">
          … {remaining} órdenes más en este certificado
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/traceability/trace-cert-orders.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/traceability/trace-cert-orders.tsx components/traceability/trace-cert-orders.test.tsx
git commit -m "$(cat <<'EOF'
feat(traceability): TraceCertOrders

Lazy-fetches cert detail when enabled (shared cache key with Slice 5).
Renders up to 10 order rows with tree connectors + footer for the
truncated remainder. Click → onSelectOrder. No "Lote" column because
CertificateOrder doesn't expose batch_id today.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `<TraceCertCard>`

**Files:**
- Create: `components/traceability/trace-cert-card.tsx`
- Create: `components/traceability/trace-cert-card.test.tsx`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/components/traceability/trace-cert-card.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from '@/test/helpers/tanstack';
import { TraceCertCard } from './trace-cert-card';
import type { CertificateSummary, CertificateDetail } from '@/lib/types/certificate';

const { mockDetail } = vi.hoisted(() => ({ mockDetail: vi.fn() }));

vi.mock('@/lib/api/certificates', () => ({
  getCertificateDetail: (...a: unknown[]) => mockDetail(...a),
}));

function cert(over: Partial<CertificateSummary> = {}): CertificateSummary {
  return {
    id: 'cert-1',
    certificate_code: 'C4572A',
    certificate_type: 'standard',
    status: 'issued',
    investor: { id: 'inv-1', legal_name: 'Alpha', rif: 'J-1' },
    investor_capital: '100000.0000',
    annual_rate: '0.130000',
    term_days: 42,
    price: '0.985060',
    nominal_target: '101516.6589',
    nominal_actual: '101516.0000',
    investor_paid: '99999.3510',
    investor_yield: '1516.6490',
    shortfall_pct: '0.000006',
    issue_date: '2026-04-27',
    maturity_date: '2026-06-08',
    cycle_week: '2026-W17',
    issued_by: { id: 'u-1', email: 'op@x.com', full_name: 'Op' },
    created_at: '2026-04-27T14:30:00Z',
    ...over,
  };
}

describe('<TraceCertCard />', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders cert row only when collapsed', () => {
    renderWithQuery(
      <TraceCertCard cert={cert()} expanded={false} onToggle={vi.fn()} onSelectOrder={vi.fn()} />,
    );
    expect(screen.getByText('C4572A')).toBeInTheDocument();
    expect(mockDetail).not.toHaveBeenCalled();
  });

  it('row click fires onToggle with cert id', () => {
    const onToggle = vi.fn();
    renderWithQuery(
      <TraceCertCard cert={cert()} expanded={false} onToggle={onToggle} onSelectOrder={vi.fn()} />,
    );
    fireEvent.click(screen.getByText('C4572A'));
    expect(onToggle).toHaveBeenCalledWith('cert-1');
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/traceability/trace-cert-card.test.tsx
```

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/traceability/trace-cert-card.tsx`:

```tsx
'use client';

import type { CertificateOrder, CertificateSummary } from '@/lib/types/certificate';
import { TraceCertRow } from './trace-cert-row';
import { TraceCertOrders } from './trace-cert-orders';

interface Props {
  cert: CertificateSummary;
  expanded: boolean;
  onToggle: (certId: string) => void;
  onSelectOrder: (order: CertificateOrder, cert: CertificateSummary) => void;
}

export function TraceCertCard({ cert, expanded, onToggle, onSelectOrder }: Props) {
  return (
    <div className="bg-card border-border-subtle overflow-hidden rounded-xl border">
      <TraceCertRow cert={cert} expanded={expanded} onToggle={onToggle} />
      <TraceCertOrders cert={cert} enabled={expanded} onSelectOrder={onSelectOrder} />
    </div>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/traceability/trace-cert-card.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/traceability/trace-cert-card.tsx components/traceability/trace-cert-card.test.tsx
git commit -m "$(cat <<'EOF'
feat(traceability): TraceCertCard

Composes TraceCertRow + TraceCertOrders. Pure layout wrapper; state
lifted to the orchestrator.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `<TraceInspector>`

**Why:** Sticky audit chain panel. Reads `payload_hash` from the TanStack cache (always populated by the time the user reaches this view).

**Files:**
- Create: `components/traceability/trace-inspector.tsx`
- Create: `components/traceability/trace-inspector.test.tsx`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/components/traceability/trace-inspector.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TraceInspector } from './trace-inspector';
import type { CertificateOrder, CertificateSummary } from '@/lib/types/certificate';

function cert(over: Partial<CertificateSummary> = {}): CertificateSummary {
  return {
    id: 'cert-1',
    certificate_code: 'C4572A',
    certificate_type: 'standard',
    status: 'issued',
    investor: { id: 'inv-1', legal_name: 'Inversora Alpha', rif: 'J-12345678-9' },
    investor_capital: '100000.0000',
    annual_rate: '0.130000',
    term_days: 42,
    price: '0.985060',
    nominal_target: '101516.6589',
    nominal_actual: '101516.0000',
    investor_paid: '99999.3510',
    investor_yield: '1516.6490',
    shortfall_pct: '0.000006',
    issue_date: '2026-04-27',
    maturity_date: '2026-06-08',
    cycle_week: '2026-W17',
    issued_by: { id: 'u-1', email: 'maria@x.com', full_name: 'María Rodríguez' },
    created_at: '2026-04-27T14:30:00Z',
    ...over,
  };
}

function order(): CertificateOrder {
  return {
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
    ],
  };
}

describe('<TraceInspector />', () => {
  it('renders 4 chain steps', () => {
    render(
      <TraceInspector
        order={order()}
        cert={cert()}
        payloadHash="abcdef1234567890abcdef"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('ORDEN')).toBeInTheDocument();
    expect(screen.getByText('CERTIFICADO')).toBeInTheDocument();
    expect(screen.getByText('INVERSOR')).toBeInTheDocument();
    expect(screen.getByText('EMITIDO POR')).toBeInTheDocument();
    expect(screen.getByText('CENTRAL MADEIRENSE')).toBeInTheDocument();
    expect(screen.getByText('C4572A')).toBeInTheDocument();
    expect(screen.getByText('Inversora Alpha')).toBeInTheDocument();
    expect(screen.getByText('María Rodríguez')).toBeInTheDocument();
  });

  it('renders truncated hash', () => {
    render(
      <TraceInspector
        order={order()}
        cert={cert()}
        payloadHash="abcdef1234567890fedcba"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/HASH/)).toBeInTheDocument();
    expect(screen.getByText(/abcdef12.*dcba/)).toBeInTheDocument();
  });

  it('renders "HASH · —" when payloadHash is null', () => {
    render(
      <TraceInspector order={order()} cert={cert()} payloadHash={null} onClose={vi.fn()} />,
    );
    expect(screen.getByText(/HASH · —/)).toBeInTheDocument();
  });

  it('click × fires onClose', () => {
    const onClose = vi.fn();
    render(
      <TraceInspector
        order={order()}
        cert={cert()}
        payloadHash="abc"
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^×$/ }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/traceability/trace-inspector.test.tsx
```

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/traceability/trace-inspector.tsx`:

```tsx
'use client';

import { fmtDate } from '@/lib/format/date';
import { fmtMoney2 } from '@/lib/format/money';
import { fmtPct } from '@/lib/format/percent';
import type { CertificateOrder, CertificateSummary } from '@/lib/types/certificate';

interface Props {
  order: CertificateOrder;
  cert: CertificateSummary;
  payloadHash: string | null;
  onClose: () => void;
}

function truncateHash(h: string): string {
  if (h.length <= 16) return h;
  return `${h.slice(0, 8)}…${h.slice(-4)}`;
}

interface Step {
  label: string;
  title: string;
  sub: string;
}

export function TraceInspector({ order, cert, payloadHash, onClose }: Props) {
  const steps: Step[] = [
    {
      label: 'ORDEN',
      title: order.merchant.current_name,
      sub: `${order.merchant.rif} · ${order.installments.length} cuotas · ${fmtMoney2(Number(order.installments_sum_snapshot))}`,
    },
    {
      label: 'CERTIFICADO',
      title: cert.certificate_code,
      sub: `Emitido ${fmtDate(cert.issue_date)} · ${cert.term_days}d @ ${fmtPct(cert.annual_rate)}`,
    },
    {
      label: 'INVERSOR',
      title: cert.investor.legal_name,
      sub: cert.investor.rif,
    },
    {
      label: 'EMITIDO POR',
      title: cert.issued_by.full_name,
      sub: 'Tesorería · usuario emisor',
    },
  ];

  return (
    <div className="bg-card border-border-subtle sticky top-4 rounded-xl border p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-text-3 mb-0.5 text-[10px] uppercase tracking-wide">
            Cadena de auditoría
          </div>
          <div className="font-mono text-[14px] font-semibold">{order.external_order_id}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="bg-subtle text-text-2 flex h-6 w-6 items-center justify-center rounded-md text-[13px]"
        >
          ×
        </button>
      </div>

      <div className="relative">
        {steps.map((step, i) => {
          const isLast = i === steps.length - 1;
          return (
            <div key={step.label} className={'relative flex gap-3 ' + (isLast ? '' : 'pb-4')}>
              {!isLast && (
                <span className="bg-border-strong absolute top-3.5 bottom-0 left-[7px] w-px" />
              )}
              <span
                className={
                  'border-text-2 relative z-10 mt-0.5 inline-block h-3.5 w-3.5 flex-shrink-0 rounded-full border-[1.5px] ' +
                  (isLast ? 'bg-text-2' : 'bg-card')
                }
              />
              <div className="min-w-0 flex-1">
                <div className="text-text-3 mb-0.5 text-[9.5px] uppercase tracking-wider">
                  {step.label}
                </div>
                <div className="text-[12.5px] font-medium leading-snug">{step.title}</div>
                <div className="text-text-3 mt-0.5 text-[10.5px] tabular-nums">{step.sub}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-subtle text-text-2 mt-4 rounded-md px-3 py-2 text-[10px]">
        <span className="text-text-3 mr-2 uppercase tracking-wider">HASH</span>
        <span className="font-mono">·</span>{' '}
        <span className="font-mono">{payloadHash ? truncateHash(payloadHash) : '—'}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/traceability/trace-inspector.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/traceability/trace-inspector.tsx components/traceability/trace-inspector.test.tsx
git commit -m "$(cat <<'EOF'
feat(traceability): TraceInspector

Sticky right-column panel with 4-step audit chain: Orden → Certificado
→ Inversor → Emitido por. Footer shows truncated payload_hash. "Lote"
step omitted in v1 (CertificateOrder doesn't expose batch_id).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `<TraceabilityPage>` orchestrator

**Why:** Glues everything: top-level certs query, expansion state, selectedOrder state, default 30-day filters.

**Files:**
- Create: `components/traceability/traceability-page.tsx`
- Create: `components/traceability/traceability-page.test.tsx`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/components/traceability/traceability-page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithQuery } from '@/test/helpers/tanstack';
import { TraceabilityPage } from './traceability-page';
import type { CertificateDetail, CertificateSummary } from '@/lib/types/certificate';

const { mockList, mockDetail } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockDetail: vi.fn(),
}));

vi.mock('@/lib/api/certificates', () => ({
  listCertificates: (...a: unknown[]) => mockList(...a),
  getCertificateDetail: (...a: unknown[]) => mockDetail(...a),
}));

function cert(over: Partial<CertificateSummary> = {}): CertificateSummary {
  return {
    id: 'cert-1',
    certificate_code: 'C4572A',
    certificate_type: 'standard',
    status: 'issued',
    investor: { id: 'inv-1', legal_name: 'Alpha', rif: 'J-1' },
    investor_capital: '100000.0000',
    annual_rate: '0.130000',
    term_days: 42,
    price: '0.985060',
    nominal_target: '101516.6589',
    nominal_actual: '101516.0000',
    investor_paid: '99999.3510',
    investor_yield: '1516.6490',
    shortfall_pct: '0.000006',
    issue_date: '2026-04-27',
    maturity_date: '2026-06-08',
    cycle_week: '2026-W17',
    issued_by: { id: 'u-1', email: 'op@x.com', full_name: 'Op' },
    created_at: '2026-04-27T14:30:00Z',
    ...over,
  };
}

function detail(): CertificateDetail {
  return {
    ...cert(),
    investor_returned: '0.65',
    payload_hash: 'abcdef1234567890fedcba',
    cancellation: null,
    orders: [
      {
        id: 'o-1',
        external_order_id: '85657474',
        merchant: { id: 'm-1', current_name: 'CENTRAL MADEIRENSE', rif: 'J-1' },
        purchase_date: '2026-03-18',
        max_due_date: '2026-04-03',
        installments_sum_snapshot: '87.24',
        assigned_at: '2026-04-27T14:30:00Z',
        installments: [
          { installment_number: 1, amount: '29.08', due_date: '2026-04-03', status: 'pending' },
        ],
      },
    ],
    events: [],
  };
}

describe('<TraceabilityPage />', () => {
  beforeEach(() => vi.clearAllMocks());

  it('smoke: header + KPIs + toolbar + cert list', async () => {
    mockList.mockResolvedValue({ data: [cert()], total: 1, limit: 100, offset: 0 });
    renderWithQuery(<TraceabilityPage />);
    expect(
      screen.getByRole('heading', { level: 1, name: /trazabilidad/i }),
    ).toBeInTheDocument();
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    const arg = mockList.mock.calls[0][0];
    expect(arg.issue_date_from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(arg.issue_date_to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(arg.sort).toBe('issue_date_desc');
    expect(arg.limit).toBe(100);
  });

  it('expanding a cert triggers getCertificateDetail', async () => {
    mockList.mockResolvedValue({ data: [cert()], total: 1, limit: 100, offset: 0 });
    mockDetail.mockResolvedValueOnce(detail());
    renderWithQuery(<TraceabilityPage />);
    await waitFor(() => expect(screen.getByText('C4572A')).toBeInTheDocument());
    fireEvent.click(screen.getByText('C4572A'));
    await waitFor(() => expect(mockDetail).toHaveBeenCalledWith('cert-1'));
  });

  it('clicking an order opens the inspector', async () => {
    mockList.mockResolvedValue({ data: [cert()], total: 1, limit: 100, offset: 0 });
    mockDetail.mockResolvedValueOnce(detail());
    renderWithQuery(<TraceabilityPage />);
    await waitFor(() => expect(screen.getByText('C4572A')).toBeInTheDocument());
    fireEvent.click(screen.getByText('C4572A'));
    await waitFor(() => expect(screen.getByText('85657474')).toBeInTheDocument());
    fireEvent.click(screen.getByText('85657474'));
    expect(screen.getByText('ORDEN')).toBeInTheDocument();
    expect(screen.getByText(/Cadena de auditoría/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/traceability/traceability-page.test.tsx
```

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/traceability/traceability-page.tsx`:

```tsx
'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/layout/page-header';
import { listCertificates } from '@/lib/api/certificates';
import { filterCertsBySearch } from '@/lib/traceability/filter';
import type {
  CertificateDetail,
  CertificateOrder,
  CertificateSummary,
} from '@/lib/types/certificate';
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
  const qc = useQueryClient();

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
  const selectedHash =
    selected && qc.getQueryData<CertificateDetail>(['certificate', selected.cert.id])?.payload_hash;

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
            hasInspector ? 'grid items-start gap-4 lg:grid-cols-[1fr_340px]' : 'flex flex-col gap-3'
          }
        >
          <div className="flex flex-col gap-3">
            {certsQ.isLoading && <CenteredCard>Cargando certificados…</CenteredCard>}
            {certsQ.isError && <CenteredCard>No se pudieron cargar los certificados.</CenteredCard>}
            {!certsQ.isLoading && !certsQ.isError && visible.length === 0 && (
              <CenteredCard italic>Sin certificados en este período.</CenteredCard>
            )}
            {visible.map(({ cert }) => (
              <TraceCertCard
                key={cert.id}
                cert={cert}
                expanded={expanded.has(cert.id)}
                onToggle={toggleExpand}
                onSelectOrder={(order, c) => setSelected({ order, cert: c })}
              />
            ))}
          </div>
          {selected && (
            <TraceInspector
              order={selected.order}
              cert={selected.cert}
              payloadHash={selectedHash ?? null}
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
      <div className={'text-text-3 text-center text-sm ' + (italic ? 'italic' : '')}>{children}</div>
    </div>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/traceability/traceability-page.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/traceability/traceability-page.tsx components/traceability/traceability-page.test.tsx
git commit -m "$(cat <<'EOF'
feat(traceability): TraceabilityPage orchestrator

Owns filters + expansion set + selectedOrder state. Default 30-day
range. Reads selected cert's payload_hash from the TanStack cache
(populated by the expand action that preceded the order click).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Wire `/traceability` route + smoke

**Files:**
- Modify: `app/(app)/traceability/page.tsx`

- [ ] **Step 1: Replace the route file**

Overwrite `/Users/llam/dev/araguaney_front/app/(app)/traceability/page.tsx` with:

```tsx
import { TraceabilityPage } from '@/components/traceability/traceability-page';

export default function TraceabilityRoute() {
  return <TraceabilityPage />;
}
```

- [ ] **Step 2: Verify + build**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
pnpm build
```

Expected: build succeeds; `/traceability` listed as `ƒ` (dynamic).

- [ ] **Step 3: Boot dev + auth-gate smoke**

```bash
cd /Users/llam/dev/araguaney_front
lsof -ti:3000 | xargs kill -9 2>/dev/null
pnpm dev > /tmp/front-task9.log 2>&1 &
PID=$!
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if grep -q "Ready in" /tmp/front-task9.log 2>/dev/null; then echo "ready in ${i}s"; break; fi
  sleep 1
done

curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3000/traceability

kill $PID 2>/dev/null
wait $PID 2>/dev/null
```

Expected: `307` → `/login`.

- [ ] **Step 4: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add "app/(app)/traceability/page.tsx"
git commit -m "$(cat <<'EOF'
feat(traceability): wire /traceability route

Replaces the Slice 1 ComingSoon stub. Server Component shell mounts
the client orchestrator. Auth gate verified locally (307 → /login).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Push + PR

**Files:** none.

- [ ] **Step 1: Push**

```bash
cd /Users/llam/dev/araguaney_front
git push -u origin feat/slice-10-traceability
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "feat: Slice 10 — /traceability chain view" --body "$(cat <<'EOF'
## Summary

Pantalla \`/traceability\` con vista de cadena para auditoría compliance:

- **Toolbar**: search debounced (código / inversor / RIF / usuario emisor) + 2 inputs de date range (default últimos 30 días)
- **3 KPI cards**: Certificados emitidos / Inversores con cobertura / Usuarios emisores
- **Lista de certs expandibles**: 1 fetch top-level (\`limit: 100\`); cada card lazy-fetcha sus órdenes via \`getCertificateDetail\` cuando el usuario hace click (cache key compartido con Slice 5)
- **Inspector lateral sticky**: cuando se hace click en una orden, panel a la derecha con cadena vertical (Orden → Certificado → Inversor → Emitido por) + payload_hash truncado leído del cache

## What's new

- \`lib/traceability/filter.ts\` (+ test) — pure search filter helper
- 7 componentes nuevos en \`components/traceability/\`
- \`app/(app)/traceability/page.tsx\` — replace ComingSoon

## Test Plan

- [x] \`pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check && pnpm build\` — todo clean
- [x] ~28 nuevos tests pasando
- [x] Smoke local: /traceability → 307 → /login (auth gate funciona)
- [ ] Vercel preview renders sin console errors
- [ ] Click cert row → expande + fetch detail
- [ ] Click order row → abre inspector con cadena visible
- [ ] Click × inspector → cierra
- [ ] Search por código / inversor / RIF / usuario filtra la lista
- [ ] Permission gating: admin + auditor ven la página, operator no la ve en el sidebar (puede acceder por URL directa, no es destructivo)

## Notes

- **No back changes** — usa endpoints existentes de Slice 5
- **No Flat-table view** — out of scope (needs back endpoint flatten)
- **No "Lote" column en order rows ni step en inspector** — \`CertificateOrder\` no expone \`batch_id\` hoy
- **No CSV / PDF export** — out of scope
- **Cert list limit 100** — periodos con >100 certs silently truncated; user puede achicar el rango
- **Order-level search** — out of scope v1 (requeriría prefetch de detalles)

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

## Summary

**What's new**

- New route `/traceability` with cert chain view + inspector.
- 7 new components in `components/traceability/`.
- `filterCertsBySearch` pure helper.
- ~28 new tests.

**Test Plan**

- [x] `pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check && pnpm build` — todo clean
- [x] ~28 nuevos tests pasando

**Notes**

- No back changes — reuses Slice 5 endpoints (cert list + detail).
- Lazy expand keeps the first paint fast.
- TanStack cache shared with `/certificates` detail page.

---

## Self-Review

**Spec coverage:**

- ✅ Chain view only (no flat table) — confirmed in Tasks 5/8
- ✅ Lazy expand per cert — Task 5 (`<TraceCertOrders>` enabled prop)
- ✅ Multi-cert expansion — Task 8 (Set<string> state)
- ✅ Inspector sticky panel — Task 7 + Task 8 layout
- ✅ Search + date range toolbar — Task 3
- ✅ 3 KPIs (no Período) — Task 2
- ✅ Default 30-day period — Task 8 `defaultFilters`
- ✅ Sweep pill for sweep certs — Task 4
- ✅ Tree connectors in order rows — Task 5
- ✅ Per-section error states — every component checks its own UseQueryResult
- ✅ Cert list limit 100 (documented as a follow-up) — Task 8
- ✅ payload_hash from TanStack cache — Task 8 `qc.getQueryData(...)`
- ✅ Permission gating via sidebar (no page-level gate) — confirmed in spec; no code needed
- ✅ Route wire-up + auth-gate smoke — Task 9
- ✅ Push + PR — Task 10

**Placeholder scan:** No TODOs / TBDs. All test fixtures concrete. All component code shown in full.

**Type/value consistency:**
- `TraceFiltersValue` (Task 3) consumed by `<TraceToolbar>` and `<TraceabilityPage>` (Task 8).
- `CertificateSummary` (existing) consumed by `<TraceCertRow>`, `<TraceCertOrders>`, `<TraceCertCard>`, `<TraceInspector>`, page.
- `CertificateOrder` (existing) consumed by `<TraceCertOrders>`, `<TraceInspector>`, page.
- `filterCertsBySearch` (Task 1) signature `(certs, query) → FilteredCert[]` consumed by page.
- `payloadHash` prop on inspector is `string | null` — page passes `selectedHash ?? null` ensuring type-safe pass-through.
- `useQuery(['certificate', id])` key matches Slice 5's detail page exactly; cache is shared.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-14-front-slice-10-traceability.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Fresh subagent per task + two-stage review.

**2. Inline Execution** — Same session with batch checkpoints.

**Which approach?**
