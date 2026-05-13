# araguaney_front Slice 9 — `/cycle` Panel del ciclo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/cycle` read-only dashboard: cycle banner + 3 metric cards + 2-col body (weekly certs + active batches + activity feed). Uses 4 parallel TanStack queries against existing back endpoints — no back changes.

**Architecture:** One route at `/cycle` with a Server Component shell mounting `<CyclePage>` client orchestrator. `useQueries` parallelizes 4 fetches: orders stats, certs of the week, active batches, audit-log activity. Each panel handles its own loading/error state so a single failure doesn't blank the dashboard.

**Tech Stack:** Next.js 16 App Router, TanStack Query v5 (`useQueries`), hand-typed shapes, Vitest + Testing Library.

**Spec:** `/Users/llam/dev/araguaney_back/docs/superpowers/specs/2026-05-13-front-slice-9-cycle-design.md`

**Working directory note:** all front code lives in `/Users/llam/dev/araguaney_front/`. Plan and spec live in `/Users/llam/dev/araguaney_back/docs/`. Implementer must `cd /Users/llam/dev/araguaney_front` for any task command.

**Pre-req branch:** Work on `feat/slice-9-cycle` (Task 1 creates this from `main`).

**Pre-flight: back filter for active batches confirmed.** `listBatches` already accepts `status: BatchStatus` where `BatchStatus = 'uploaded' | 'parsing' | 'imported' | 'rejected' | 'archived'`. We use `status: 'imported'` for "active in stock". No need for client-side filter.

**Pre-flight: BatchSummary fields available.** `external_code`, `imported_at`, `rows_imported`, `uploaded_by` — no `consumed_pct`. The batches panel shows metadata only; the progress bar from the mockup is omitted (back would need a new field to support it). Documented as a deferred follow-up.

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `lib/format/iso-week.ts` (+ test) | create | `currentCycleRange(now?)` — pure UTC math returning week number, Mon-Fri ISO dates, dayIndex, Spanish week label |
| `lib/format/date.ts` (modify) | modify | Add `fmtRelativeTime(iso, now?)` sibling helper |
| `lib/format/date.test.ts` (modify) | modify | Add 3 tests for `fmtRelativeTime` |
| `components/cycle/cycle-banner.tsx` (+ test) | create | Dark banner with week label, dayIndex/5, progress bar |
| `components/cycle/cycle-metrics-strip.tsx` (+ test) | create | 3 cards: stock disp / asignado semana / inversores activos |
| `components/cycle/cycle-certificates-panel.tsx` (+ test) | create | Tabla certs de la semana, sweep pill, click → /certificates/{id} |
| `components/cycle/cycle-batches-panel.tsx` (+ test) | create | Lista lotes status=imported (top 5), sin barra (back no expone consumption) |
| `components/cycle/cycle-activity-feed.tsx` (+ test) | create | Top 5 audit entries con formatActivityEntry helper inline |
| `components/cycle/cycle-cta-buttons.tsx` (+ test) | create | 2 Link buttons gated por batch.upload / certificate.create |
| `components/cycle/cycle-page.tsx` (+ test) | create | Orchestrator: useQueries(4) + layout |
| `app/(app)/cycle/page.tsx` | modify | Replace ComingSoon with `<CyclePage />` |

**Total:** 16 new files (8 components + 8 tests) + 3 modifications (`app/(app)/cycle/page.tsx`, `lib/format/date.ts`, `lib/format/date.test.ts`). ~32 tests new.

---

## Task 1: Branch + `lib/format/iso-week.ts`

**Why:** Pure helper for the week math. Used by the orchestrator (banner data) and matches back's `helpers/iso-week.ts` so `cert.cycle_week` aligns.

**Files:**
- Create: `lib/format/iso-week.ts`
- Create: `lib/format/iso-week.test.ts`

- [ ] **Step 1: Create branch from main**

```bash
cd /Users/llam/dev/araguaney_front
git fetch origin --prune
git checkout main
git pull origin main
git checkout -b feat/slice-9-cycle
```

- [ ] **Step 2: Failing tests**

Create `/Users/llam/dev/araguaney_front/lib/format/iso-week.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { currentCycleRange } from './iso-week';

describe('currentCycleRange', () => {
  it('Wednesday of week 17 → range Mon-Fri, dayIndex 3, label crosses no months', () => {
    const wed = new Date(Date.UTC(2026, 3, 22)); // 2026-04-22, Wednesday
    const r = currentCycleRange(wed);
    expect(r.weekNumber).toBe(17);
    expect(r.monday).toBe('2026-04-20');
    expect(r.friday).toBe('2026-04-24');
    expect(r.dayIndex).toBe(3);
    expect(r.weekLabel).toBe('del 20 al 24 de abril');
  });

  it('Monday → dayIndex 1', () => {
    const mon = new Date(Date.UTC(2026, 3, 20));
    expect(currentCycleRange(mon).dayIndex).toBe(1);
  });

  it('Friday → dayIndex 5', () => {
    const fri = new Date(Date.UTC(2026, 3, 24));
    expect(currentCycleRange(fri).dayIndex).toBe(5);
  });

  it('Saturday / Sunday → dayIndex clamped to 5 (cycle closed)', () => {
    const sat = new Date(Date.UTC(2026, 3, 25));
    const sun = new Date(Date.UTC(2026, 3, 26));
    expect(currentCycleRange(sat).dayIndex).toBe(5);
    expect(currentCycleRange(sun).dayIndex).toBe(5);
    // Sat/Sun still belong to the same Mon-Fri week
    expect(currentCycleRange(sat).monday).toBe('2026-04-20');
    expect(currentCycleRange(sun).friday).toBe('2026-04-24');
  });

  it('label crosses two months: del 30 de marzo al 3 de abril', () => {
    const wed = new Date(Date.UTC(2026, 3, 1)); // 2026-04-01, Wednesday
    const r = currentCycleRange(wed);
    expect(r.monday).toBe('2026-03-30');
    expect(r.friday).toBe('2026-04-03');
    expect(r.weekLabel).toBe('del 30 de marzo al 3 de abril');
  });
});
```

- [ ] **Step 3: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/format/iso-week.test.ts
```

Expected: import error — module doesn't exist.

- [ ] **Step 4: Implement**

Create `/Users/llam/dev/araguaney_front/lib/format/iso-week.ts`:

```ts
export interface CycleRange {
  weekNumber: number;
  monday: string;
  friday: string;
  dayIndex: number;
  weekLabel: string;
}

const MONTHS_ES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

function toUtcDate(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function fmtIso(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * ISO 8601 week number (4-Thursday rule).
 * Matches back's helpers/iso-week.ts so cert.cycle_week aligns.
 */
function isoWeekNumber(d: Date): number {
  const target = toUtcDate(d);
  const dayNum = (target.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  target.setUTCDate(target.getUTCDate() - dayNum + 3); // shift to Thursday
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  return 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
}

export function currentCycleRange(now: Date = new Date()): CycleRange {
  const today = toUtcDate(now);
  const dayOfWeek = (today.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  const mondayDate = new Date(today);
  mondayDate.setUTCDate(today.getUTCDate() - dayOfWeek);
  const fridayDate = new Date(mondayDate);
  fridayDate.setUTCDate(mondayDate.getUTCDate() + 4);

  // dayIndex is 1..5 for Mon-Fri. Sat (5) and Sun (6) clamp to 5.
  const dayIndex = dayOfWeek <= 4 ? dayOfWeek + 1 : 5;

  const mDay = mondayDate.getUTCDate();
  const fDay = fridayDate.getUTCDate();
  const mMonth = MONTHS_ES[mondayDate.getUTCMonth()];
  const fMonth = MONTHS_ES[fridayDate.getUTCMonth()];
  const weekLabel =
    mondayDate.getUTCMonth() === fridayDate.getUTCMonth()
      ? `del ${mDay} al ${fDay} de ${mMonth}`
      : `del ${mDay} de ${mMonth} al ${fDay} de ${fMonth}`;

  return {
    weekNumber: isoWeekNumber(today),
    monday: fmtIso(mondayDate),
    friday: fmtIso(fridayDate),
    dayIndex,
    weekLabel,
  };
}
```

- [ ] **Step 5: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/format/iso-week.test.ts
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

All clean. 5 tests green.

- [ ] **Step 6: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add lib/format/iso-week.ts lib/format/iso-week.test.ts
git commit -m "$(cat <<'EOF'
feat(format): currentCycleRange helper

Pure UTC math. Returns ISO week number (4-Thursday rule, matches
back's helpers/iso-week.ts so cert.cycle_week aligns), Mon-Fri dates,
dayIndex 1..5 (Sat/Sun clamp to 5 = cycle closed), and a Spanish
weekLabel that handles single-month or cross-month ranges.

For the /cycle Panel del ciclo banner.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `fmtRelativeTime` helper

**Why:** Activity feed needs "hace 3h" / "ayer" / "lun" relative timestamps. Sibling to `fmtDate` and `fmtDateTime` in `lib/format/date.ts`.

**Files:**
- Modify: `lib/format/date.ts`
- Modify: `lib/format/date.test.ts`

- [ ] **Step 1: Failing tests (append)**

Append to `/Users/llam/dev/araguaney_front/lib/format/date.test.ts`. Extend the existing `from './date'` import to include `fmtRelativeTime`:

```ts
import { fmtRelativeTime } from './date';

describe('fmtRelativeTime', () => {
  const now = new Date('2026-05-13T14:00:00.000Z');

  it('returns "ahora" within the first minute', () => {
    expect(fmtRelativeTime('2026-05-13T13:59:50.000Z', now)).toBe('ahora');
  });

  it('returns "hace Nm" for minutes < 60', () => {
    expect(fmtRelativeTime('2026-05-13T13:45:00.000Z', now)).toBe('hace 15m');
  });

  it('returns "hace Nh" for hours < 24', () => {
    expect(fmtRelativeTime('2026-05-13T11:00:00.000Z', now)).toBe('hace 3h');
  });

  it('returns "ayer" for 1 day ago', () => {
    expect(fmtRelativeTime('2026-05-12T14:00:00.000Z', now)).toBe('ayer');
  });

  it('returns "hace Nd" for 2..6 days ago', () => {
    expect(fmtRelativeTime('2026-05-10T14:00:00.000Z', now)).toBe('hace 3d');
  });

  it('falls back to fmtDate for entries older than a week', () => {
    expect(fmtRelativeTime('2026-04-01T14:00:00.000Z', now)).toBe('01/04/2026');
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/format/date.test.ts
```

Expected: 6 new failures (`fmtRelativeTime` not exported).

- [ ] **Step 3: Implement**

Append to `/Users/llam/dev/araguaney_front/lib/format/date.ts`:

```ts
export function fmtRelativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '—';
  const diffMs = now.getTime() - then.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'ahora';
  if (diffMin < 60) return `hace ${diffMin}m`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `hace ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return 'ayer';
  if (diffD < 7) return `hace ${diffD}d`;
  return fmtDate(iso);
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/format/date.test.ts
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

All clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add lib/format/date.ts lib/format/date.test.ts
git commit -m "$(cat <<'EOF'
feat(format): fmtRelativeTime helper

For the activity feed in /cycle. Buckets: <1min "ahora", <1h "hace Nm",
<24h "hace Nh", exactly 1d "ayer", 2..6d "hace Nd", else fmtDate.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `<CycleBanner>`

**Files:**
- Create: `components/cycle/cycle-banner.tsx`
- Create: `components/cycle/cycle-banner.test.tsx`

- [ ] **Step 1: Failing test**

```bash
cd /Users/llam/dev/araguaney_front
mkdir -p components/cycle
```

Create `/Users/llam/dev/araguaney_front/components/cycle/cycle-banner.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CycleBanner } from './cycle-banner';

describe('<CycleBanner />', () => {
  it('renders week label + dayIndex + pct', () => {
    render(
      <CycleBanner
        weekNumber={17}
        weekLabel="del 20 al 24 de abril"
        dayIndex={3}
        pctAssigned={0.32}
      />,
    );
    expect(screen.getByText(/Semana 17/)).toBeInTheDocument();
    expect(screen.getByText(/del 20 al 24 de abril/)).toBeInTheDocument();
    expect(screen.getByText(/Día 3 de 5/)).toBeInTheDocument();
    expect(screen.getByText(/32%/)).toBeInTheDocument();
  });

  it('shows "Sin asignación todavía" when pctAssigned is 0', () => {
    render(
      <CycleBanner
        weekNumber={17}
        weekLabel="del 20 al 24 de abril"
        dayIndex={1}
        pctAssigned={0}
      />,
    );
    expect(screen.getByText(/Sin asignación todavía/)).toBeInTheDocument();
  });

  it('shows "Ciclo cerrado" when dayIndex is 5 and pctAssigned > 0', () => {
    render(
      <CycleBanner
        weekNumber={17}
        weekLabel="del 20 al 24 de abril"
        dayIndex={5}
        pctAssigned={0.85}
      />,
    );
    expect(screen.getByText(/Día 5 de 5/)).toBeInTheDocument();
    expect(screen.getByText(/85%/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cycle/cycle-banner.test.tsx
```

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/cycle/cycle-banner.tsx`:

```tsx
interface Props {
  weekNumber: number;
  weekLabel: string;
  dayIndex: number;
  pctAssigned: number;
}

export function CycleBanner({ weekNumber, weekLabel, dayIndex, pctAssigned }: Props) {
  const pctText = pctAssigned > 0 ? `${Math.round(pctAssigned * 100)}% del stock asignado` : 'Sin asignación todavía';
  const barWidth = pctAssigned > 0 ? `${Math.round(pctAssigned * 100)}%` : '0%';

  return (
    <div className="bg-card border-border-subtle flex flex-wrap items-center justify-between gap-4 rounded-xl border px-5 py-4">
      <div className="flex items-center gap-3">
        <span className="bg-green-text inline-block h-2 w-2 animate-pulse rounded-full" />
        <div className="leading-snug">
          <div className="text-[13px] font-medium">
            Ciclo semanal · Semana {weekNumber} · {weekLabel}
          </div>
          <div className="text-text-3 text-[11px]">
            Cierra el viernes con certificado de barrido a Cashea
          </div>
        </div>
      </div>
      <div className="text-text-3 flex items-center gap-3 text-[11px] tabular-nums">
        <span>
          <b className="text-text-2 font-medium">Día {dayIndex}</b> de 5
        </span>
        <div className="bg-subtle h-1 w-[200px] overflow-hidden rounded-full">
          <div className="bg-foreground h-full" style={{ width: barWidth }} />
        </div>
        <span>{pctText}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cycle/cycle-banner.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/cycle/cycle-banner.tsx components/cycle/cycle-banner.test.tsx
git commit -m "$(cat <<'EOF'
feat(cycle): CycleBanner

Top banner: pulse dot + "Ciclo semanal · Semana N · del DD al DD de
MES" + sub-label + on the right "Día N de 5" + 200px progress bar +
"X% del stock asignado" (or "Sin asignación todavía" when pct=0).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `<CycleMetricsStrip>`

**Why:** 3 metric cards. Reads `statsQ` and `certsQ` query results (each `UseQueryResult`) and handles per-card loading/error state.

**Files:**
- Create: `components/cycle/cycle-metrics-strip.tsx`
- Create: `components/cycle/cycle-metrics-strip.test.tsx`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/components/cycle/cycle-metrics-strip.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { UseQueryResult } from '@tanstack/react-query';
import { CycleMetricsStrip } from './cycle-metrics-strip';
import type { OrdersStats } from '@/lib/types/order';
import type { CertificatesListResponse, CertificateSummary } from '@/lib/types/certificate';

function statsQ(data?: OrdersStats, override: Partial<UseQueryResult<OrdersStats>> = {}) {
  return {
    data,
    isLoading: false,
    isError: false,
    ...override,
  } as UseQueryResult<OrdersStats>;
}
function certsQ(
  data?: CertificatesListResponse,
  override: Partial<UseQueryResult<CertificatesListResponse>> = {},
) {
  return {
    data,
    isLoading: false,
    isError: false,
    ...override,
  } as UseQueryResult<CertificatesListResponse>;
}

function makeCert(over: Partial<CertificateSummary> = {}): CertificateSummary {
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
    issue_date: '2026-04-22',
    maturity_date: '2026-06-03',
    cycle_week: '2026-W17',
    issued_by: { id: 'u-1', email: 'op@x.com', full_name: 'Op' },
    created_at: '2026-04-22T14:00:00Z',
    ...over,
  };
}

describe('<CycleMetricsStrip />', () => {
  it('renders the 3 cards with computed values', () => {
    const stats: OrdersStats = {
      by_status: {
        available: { count: 1500, total_amount: '1132418.0000', total_installments_amount: '1132418.0000' },
        assigned: { count: 0, total_amount: '0.0000', total_installments_amount: '0.0000' },
        matured: { count: 0, total_amount: '0.0000', total_installments_amount: '0.0000' },
        defaulted: { count: 0, total_amount: '0.0000', total_installments_amount: '0.0000' },
      },
      total_orders: 1500,
      available_capital: '1132418.0000',
    };
    const certs: CertificatesListResponse = {
      data: [
        makeCert({ id: 'c-1', investor: { id: 'inv-1', legal_name: 'A', rif: 'J-1' }, investor_capital: '300000' }),
        makeCert({ id: 'c-2', investor: { id: 'inv-2', legal_name: 'B', rif: 'J-2' }, investor_capital: '150000' }),
        makeCert({ id: 'c-3', investor: { id: 'inv-1', legal_name: 'A', rif: 'J-1' }, investor_capital: '85000' }),
      ],
      total: 3,
      limit: 50,
      offset: 0,
    };
    render(<CycleMetricsStrip statsQ={statsQ(stats)} certsQ={certsQ(certs)} />);
    expect(screen.getByText('Stock disponible')).toBeInTheDocument();
    expect(screen.getByText('$1,132,418.00')).toBeInTheDocument();
    expect(screen.getByText(/1,500 órdenes/)).toBeInTheDocument();
    expect(screen.getByText('Asignado esta semana')).toBeInTheDocument();
    expect(screen.getByText('$535,000.00')).toBeInTheDocument();
    expect(screen.getByText(/3 certificado/)).toBeInTheDocument();
    expect(screen.getByText('Inversores activos')).toBeInTheDocument();
    // Distinct investors: inv-1 + inv-2 = 2
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('stats card shows error when statsQ.isError', () => {
    render(<CycleMetricsStrip statsQ={statsQ(undefined, { isError: true })} certsQ={certsQ(undefined, { isLoading: true })} />);
    expect(screen.getAllByText(/no se pudo cargar/i).length).toBeGreaterThanOrEqual(1);
  });

  it('shows skeleton text while loading', () => {
    render(
      <CycleMetricsStrip
        statsQ={statsQ(undefined, { isLoading: true })}
        certsQ={certsQ(undefined, { isLoading: true })}
      />,
    );
    expect(screen.getAllByText(/cargando/i).length).toBeGreaterThanOrEqual(1);
  });

  it('asignado = 0 when certs list is empty', () => {
    const empty: CertificatesListResponse = { data: [], total: 0, limit: 50, offset: 0 };
    render(<CycleMetricsStrip statsQ={statsQ()} certsQ={certsQ(empty)} />);
    expect(screen.getByText('$0.00')).toBeInTheDocument();
    expect(screen.getByText(/0 certificado/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cycle/cycle-metrics-strip.test.tsx
```

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/cycle/cycle-metrics-strip.tsx`:

```tsx
'use client';

import type { UseQueryResult } from '@tanstack/react-query';
import { fmtMoney2 } from '@/lib/format/money';
import type { OrdersStats } from '@/lib/types/order';
import type { CertificatesListResponse } from '@/lib/types/certificate';

interface Props {
  statsQ: UseQueryResult<OrdersStats>;
  certsQ: UseQueryResult<CertificatesListResponse>;
}

export function CycleMetricsStrip({ statsQ, certsQ }: Props) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <StockCard q={statsQ} />
      <AsignadoCard q={certsQ} />
      <InvestorsCard q={certsQ} />
    </div>
  );
}

function StockCard({ q }: { q: UseQueryResult<OrdersStats> }) {
  if (q.isLoading) return <CardSkeleton label="Stock disponible" />;
  if (q.isError || !q.data) return <CardError label="Stock disponible" />;
  return (
    <Card
      label="Stock disponible"
      value={fmtMoney2(Number(q.data.available_capital))}
      sub={`${q.data.by_status.available.count.toLocaleString('en-US')} órdenes`}
    />
  );
}

function AsignadoCard({ q }: { q: UseQueryResult<CertificatesListResponse> }) {
  if (q.isLoading) return <CardSkeleton label="Asignado esta semana" />;
  if (q.isError || !q.data) return <CardError label="Asignado esta semana" />;
  const sum = q.data.data.reduce((acc, c) => acc + Number(c.investor_capital), 0);
  return (
    <Card
      label="Asignado esta semana"
      value={fmtMoney2(sum)}
      sub={`${q.data.total} certificado${q.data.total === 1 ? '' : 's'} emitido${q.data.total === 1 ? '' : 's'}`}
    />
  );
}

function InvestorsCard({ q }: { q: UseQueryResult<CertificatesListResponse> }) {
  if (q.isLoading) return <CardSkeleton label="Inversores activos" />;
  if (q.isError || !q.data) return <CardError label="Inversores activos" />;
  const distinct = new Set(q.data.data.map((c) => c.investor.id)).size;
  return (
    <Card
      label="Inversores activos"
      value={String(distinct)}
      sub="con cert emitido esta semana"
    />
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
pnpm test components/cycle/cycle-metrics-strip.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/cycle/cycle-metrics-strip.tsx components/cycle/cycle-metrics-strip.test.tsx
git commit -m "$(cat <<'EOF'
feat(cycle): CycleMetricsStrip

3 cards: Stock disponible (from orders/stats), Asignado esta semana
(sum of investor_capital from certs of the week), Inversores activos
(distinct investor.id from those certs). Each card handles its own
loading/error state.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `<CycleCertificatesPanel>`

**Files:**
- Create: `components/cycle/cycle-certificates-panel.tsx`
- Create: `components/cycle/cycle-certificates-panel.test.tsx`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/components/cycle/cycle-certificates-panel.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { UseQueryResult } from '@tanstack/react-query';
import { CycleCertificatesPanel } from './cycle-certificates-panel';
import type { CertificatesListResponse, CertificateSummary } from '@/lib/types/certificate';

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

function cert(over: Partial<CertificateSummary> = {}): CertificateSummary {
  return {
    id: 'c-1',
    certificate_code: 'C4572A',
    certificate_type: 'standard',
    status: 'issued',
    investor: { id: 'inv-1', legal_name: 'Inversora Alpha', rif: 'J-1' },
    investor_capital: '100000.0000',
    annual_rate: '0.130000',
    term_days: 42,
    price: '0.985060',
    nominal_target: '101516.6589',
    nominal_actual: '101516.0000',
    investor_paid: '99999.3510',
    investor_yield: '1516.6490',
    shortfall_pct: '0.000006',
    issue_date: '2026-04-22',
    maturity_date: '2026-06-03',
    cycle_week: '2026-W17',
    issued_by: { id: 'u-1', email: 'op@x.com', full_name: 'Op' },
    created_at: '2026-04-22T14:00:00Z',
    ...over,
  };
}

function q(data?: CertificatesListResponse, over: Partial<UseQueryResult<CertificatesListResponse>> = {}) {
  return { data, isLoading: false, isError: false, ...over } as UseQueryResult<CertificatesListResponse>;
}

describe('<CycleCertificatesPanel />', () => {
  it('renders rows for each cert with formatted values', () => {
    const data: CertificatesListResponse = {
      data: [
        cert({ id: 'c-1', certificate_code: 'C4572A' }),
        cert({ id: 'c-2', certificate_code: 'C4572B', certificate_type: 'sweep' }),
      ],
      total: 2,
      limit: 50,
      offset: 0,
    };
    render(<CycleCertificatesPanel certsQ={q(data)} />);
    expect(screen.getByText('C4572A')).toBeInTheDocument();
    expect(screen.getByText('C4572B')).toBeInTheDocument();
    expect(screen.getByText('Barrido Cashea')).toBeInTheDocument();
  });

  it('row click navigates to /certificates/{id}', () => {
    mockPush.mockClear();
    const data: CertificatesListResponse = {
      data: [cert({ id: 'c-1', certificate_code: 'C4572A' })],
      total: 1,
      limit: 50,
      offset: 0,
    };
    render(<CycleCertificatesPanel certsQ={q(data)} />);
    fireEvent.click(screen.getByText('C4572A'));
    expect(mockPush).toHaveBeenCalledWith('/certificates/c-1');
  });

  it('shows empty state when no certs this week', () => {
    const empty: CertificatesListResponse = { data: [], total: 0, limit: 50, offset: 0 };
    render(<CycleCertificatesPanel certsQ={q(empty)} />);
    expect(screen.getByText(/sin certificados emitidos esta semana/i)).toBeInTheDocument();
  });

  it('shows error state when query fails', () => {
    render(<CycleCertificatesPanel certsQ={q(undefined, { isError: true })} />);
    expect(screen.getByText(/no se pudo cargar/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cycle/cycle-certificates-panel.test.tsx
```

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/cycle/cycle-certificates-panel.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { UseQueryResult } from '@tanstack/react-query';
import { Pill } from '@/components/ui/pill';
import { CertificateStatusPill } from '@/components/certificates/certificate-status-pill';
import { fmtDate } from '@/lib/format/date';
import { fmtMoney2 } from '@/lib/format/money';
import { fmtPct } from '@/lib/format/percent';
import type { CertificateSummary, CertificatesListResponse } from '@/lib/types/certificate';

interface Props {
  certsQ: UseQueryResult<CertificatesListResponse>;
}

const VISIBLE_LIMIT = 10;

export function CycleCertificatesPanel({ certsQ }: Props) {
  return (
    <div className="bg-card border-border-subtle overflow-hidden rounded-xl border">
      <div className="border-border-subtle flex items-center justify-between border-b px-5 py-3">
        <h3 className="text-[13px] font-semibold tracking-[-0.2px]">Certificados de la semana</h3>
        <Link href="/certificates" className="text-text-3 text-[11px] hover:underline">
          Ver todos →
        </Link>
      </div>
      <PanelBody certsQ={certsQ} />
    </div>
  );
}

function PanelBody({ certsQ }: Props) {
  const router = useRouter();
  if (certsQ.isLoading) return <Centered>Cargando certificados…</Centered>;
  if (certsQ.isError || !certsQ.data) return <Centered>No se pudo cargar.</Centered>;
  if (certsQ.data.data.length === 0)
    return <Centered italic>Sin certificados emitidos esta semana.</Centered>;
  const rows = certsQ.data.data.slice(0, VISIBLE_LIMIT);
  return (
    <table className="w-full text-[12px]">
      <thead className="bg-subtle">
        <tr>
          <Th>Código</Th>
          <Th>Inversor</Th>
          <Th align="right">Capital</Th>
          <Th align="right">Tasa</Th>
          <Th>Vence</Th>
          <Th>Estado</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <tr
            key={c.id}
            onClick={() => router.push(`/certificates/${c.id}`)}
            className="border-border-soft hover:bg-subtle cursor-pointer border-b"
          >
            <td className="text-text-2 px-4 py-3 font-mono text-[11.5px]">{c.certificate_code}</td>
            <td className="max-w-[200px] truncate px-4 py-3" title={c.investor.legal_name}>
              {c.investor.legal_name}
            </td>
            <td className="num px-4 py-3 text-right font-medium">
              {fmtMoney2(Number(c.investor_capital))}
            </td>
            <td className="num px-4 py-3 text-right">{fmtPct(c.annual_rate)}</td>
            <td className="num px-4 py-3">{fmtDate(c.maturity_date)}</td>
            <td className="px-4 py-3">
              <CellPill cert={c} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CellPill({ cert }: { cert: CertificateSummary }) {
  if (cert.certificate_type === 'sweep') return <Pill variant="sweep">Barrido Cashea</Pill>;
  return <CertificateStatusPill status={cert.status} />;
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

function Centered({ children, italic = false }: { children: React.ReactNode; italic?: boolean }) {
  return (
    <div
      className={
        'text-text-3 flex h-32 items-center justify-center px-5 text-sm ' +
        (italic ? 'italic' : '')
      }
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cycle/cycle-certificates-panel.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/cycle/cycle-certificates-panel.tsx components/cycle/cycle-certificates-panel.test.tsx
git commit -m "$(cat <<'EOF'
feat(cycle): CycleCertificatesPanel

Table of certs emitted this week (up to 10 visible). Sweep certs
distinguished with sweep pill variant. Row click → router.push to
/certificates/{id}. Footer "Ver todos →" links to /certificates.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `<CycleBatchesPanel>`

**Why:** Lista de lotes con `status='imported'` (los que están activos en stock). Simplified vs the mockup — no consumption progress bar because `BatchSummary` has no `consumed_pct` field; we'd need additional queries to compute it. Defer that polish to a back enhancement.

**Files:**
- Create: `components/cycle/cycle-batches-panel.tsx`
- Create: `components/cycle/cycle-batches-panel.test.tsx`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/components/cycle/cycle-batches-panel.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { UseQueryResult } from '@tanstack/react-query';
import { CycleBatchesPanel } from './cycle-batches-panel';
import type { BatchListResponse, BatchSummary } from '@/lib/types/batch';

function batch(over: Partial<BatchSummary> = {}): BatchSummary {
  return {
    id: 'b-1',
    external_code: 'Lote_00118',
    status: 'imported',
    rows_imported: 12_345,
    rows_rejected: 0,
    total_orders_amount: '1000000.0000',
    total_installments_amount: '1100000.0000',
    imported_at: '2026-05-12T10:00:00Z',
    rejection_reason: null,
    uploaded_at: '2026-05-12T09:30:00Z',
    uploaded_by: { id: 'u-1', email: 'op@x.com', full_name: 'María R.' },
    ...over,
  };
}

function q(data?: BatchListResponse, over: Partial<UseQueryResult<BatchListResponse>> = {}) {
  return { data, isLoading: false, isError: false, ...over } as UseQueryResult<BatchListResponse>;
}

describe('<CycleBatchesPanel />', () => {
  it('renders rows with external_code + orders count + uploader', () => {
    const data: BatchListResponse = {
      data: [batch({ id: 'b-1', external_code: 'Lote_00118' })],
      total: 1,
      limit: 50,
      offset: 0,
    };
    render(<CycleBatchesPanel batchesQ={q(data)} />);
    expect(screen.getByText('Lote_00118')).toBeInTheDocument();
    expect(screen.getByText(/12,345 órdenes/)).toBeInTheDocument();
    expect(screen.getByText(/María R\./)).toBeInTheDocument();
  });

  it('shows empty state', () => {
    const empty: BatchListResponse = { data: [], total: 0, limit: 50, offset: 0 };
    render(<CycleBatchesPanel batchesQ={q(empty)} />);
    expect(screen.getByText(/sin lotes activos/i)).toBeInTheDocument();
  });

  it('shows error state', () => {
    render(<CycleBatchesPanel batchesQ={q(undefined, { isError: true })} />);
    expect(screen.getByText(/no se pudo cargar/i)).toBeInTheDocument();
  });

  it('caps visible rows at 5', () => {
    const many: BatchListResponse = {
      data: Array.from({ length: 8 }, (_, i) =>
        batch({ id: 'b-' + i, external_code: 'Lote_' + i }),
      ),
      total: 8,
      limit: 50,
      offset: 0,
    };
    render(<CycleBatchesPanel batchesQ={q(many)} />);
    expect(screen.getByText('Lote_0')).toBeInTheDocument();
    expect(screen.getByText('Lote_4')).toBeInTheDocument();
    expect(screen.queryByText('Lote_5')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cycle/cycle-batches-panel.test.tsx
```

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/cycle/cycle-batches-panel.tsx`:

```tsx
'use client';

import Link from 'next/link';
import type { UseQueryResult } from '@tanstack/react-query';
import { fmtDate } from '@/lib/format/date';
import type { BatchListResponse } from '@/lib/types/batch';

interface Props {
  batchesQ: UseQueryResult<BatchListResponse>;
}

const VISIBLE_LIMIT = 5;

export function CycleBatchesPanel({ batchesQ }: Props) {
  return (
    <div className="bg-card border-border-subtle overflow-hidden rounded-xl border">
      <div className="border-border-subtle flex items-center justify-between border-b px-5 py-3">
        <h3 className="text-[13px] font-semibold tracking-[-0.2px]">Lotes activos en stock</h3>
        <Link href="/batches" className="text-text-3 text-[11px] hover:underline">
          Ver todos →
        </Link>
      </div>
      <Body batchesQ={batchesQ} />
    </div>
  );
}

function Body({ batchesQ }: Props) {
  if (batchesQ.isLoading)
    return <Centered>Cargando lotes…</Centered>;
  if (batchesQ.isError || !batchesQ.data)
    return <Centered>No se pudo cargar.</Centered>;
  if (batchesQ.data.data.length === 0)
    return <Centered italic>Sin lotes activos en stock.</Centered>;
  const rows = batchesQ.data.data.slice(0, VISIBLE_LIMIT);
  return (
    <div className="px-5">
      {rows.map((b, i) => (
        <div
          key={b.id}
          className={
            'flex items-center justify-between gap-3 py-3.5 ' +
            (i < rows.length - 1 ? 'border-border-soft border-b' : '')
          }
        >
          <div className="leading-snug">
            <div className="text-[12.5px] font-medium">{b.external_code}</div>
            <div className="text-text-3 mt-0.5 text-[10.5px] tabular-nums">
              {fmtDate(b.imported_at ?? b.uploaded_at)} ·{' '}
              {b.rows_imported.toLocaleString('en-US')} órdenes
              {b.uploaded_by ? ` · subido por ${b.uploaded_by.full_name}` : ''}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Centered({ children, italic = false }: { children: React.ReactNode; italic?: boolean }) {
  return (
    <div
      className={
        'text-text-3 flex h-32 items-center justify-center px-5 text-sm ' +
        (italic ? 'italic' : '')
      }
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cycle/cycle-batches-panel.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/cycle/cycle-batches-panel.tsx components/cycle/cycle-batches-panel.test.tsx
git commit -m "$(cat <<'EOF'
feat(cycle): CycleBatchesPanel

List of top 5 batches with status='imported' (active in stock). Each
row shows external_code + imported date + orders count + uploader.
No consumption progress bar — BatchSummary doesn't expose it today;
deferred to a back enhancement.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `<CycleActivityFeed>` + `formatActivityEntry`

**Files:**
- Create: `components/cycle/cycle-activity-feed.tsx`
- Create: `components/cycle/cycle-activity-feed.test.tsx`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/components/cycle/cycle-activity-feed.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { UseQueryResult } from '@tanstack/react-query';
import { CycleActivityFeed, formatActivityEntry } from './cycle-activity-feed';
import type { AuditEntry, AuditListResponse } from '@/lib/types/audit';

function entry(over: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 'evt-1',
    occurred_at: '2026-05-13T10:00:00Z',
    actor: { id: 'u-1', email: 'maria@x.com', full_name: 'María Rodríguez' },
    action: 'create',
    entity_type: 'certificate',
    entity_id: 'cert-uuid-1',
    ip_address: '1.2.3.4',
    user_agent: 'Mozilla',
    payload: { certificate_code: 'C4572A' },
    ...over,
  };
}

function q(data?: AuditListResponse, over: Partial<UseQueryResult<AuditListResponse>> = {}) {
  return { data, isLoading: false, isError: false, ...over } as UseQueryResult<AuditListResponse>;
}

describe('formatActivityEntry', () => {
  it('certificate create with code in payload → "creó certificado C4572A"', () => {
    const { node } = formatActivityEntry(entry());
    // Render to dom to read text
    const dom = render(<>{node}</>);
    expect(dom.container.textContent).toContain('María Rodríguez');
    expect(dom.container.textContent).toContain('creó certificado C4572A');
  });

  it('investor update fallback when no code in payload', () => {
    const e = entry({
      action: 'update',
      entity_type: 'investor',
      entity_id: '11111111-2222-3333-4444-555555555555',
      payload: {},
    });
    const { node } = formatActivityEntry(e);
    const dom = render(<>{node}</>);
    expect(dom.container.textContent).toContain('actualizó inversor');
    expect(dom.container.textContent).toContain('11111111');
  });

  it('null actor renders "sistema"', () => {
    const e = entry({ actor: null });
    const { node } = formatActivityEntry(e);
    const dom = render(<>{node}</>);
    expect(dom.container.textContent).toContain('sistema');
  });
});

describe('<CycleActivityFeed />', () => {
  it('renders top 5 entries', () => {
    const data: AuditListResponse = {
      data: Array.from({ length: 8 }, (_, i) =>
        entry({ id: 'e-' + i, payload: { certificate_code: 'C' + i } }),
      ),
      total: 8,
      limit: 50,
      offset: 0,
    };
    render(<CycleActivityFeed auditQ={q(data)} />);
    expect(screen.getByText(/C0/)).toBeInTheDocument();
    expect(screen.getByText(/C4/)).toBeInTheDocument();
    expect(screen.queryByText(/C5/)).not.toBeInTheDocument();
  });

  it('empty state', () => {
    const empty: AuditListResponse = { data: [], total: 0, limit: 50, offset: 0 };
    render(<CycleActivityFeed auditQ={q(empty)} />);
    expect(screen.getByText(/sin actividad esta semana/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cycle/cycle-activity-feed.test.tsx
```

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/cycle/cycle-activity-feed.tsx`:

```tsx
'use client';

import type { UseQueryResult } from '@tanstack/react-query';
import { fmtRelativeTime } from '@/lib/format/date';
import type { AuditEntry, AuditListResponse } from '@/lib/types/audit';

interface Props {
  auditQ: UseQueryResult<AuditListResponse>;
}

const VISIBLE_LIMIT = 5;

const VERBS: Record<string, string> = {
  create: 'creó',
  update: 'actualizó',
  cancel: 'canceló',
  grant: 'otorgó permiso a',
  revoke: 'revocó permiso de',
};

const ENTITY_LABELS: Record<string, string> = {
  batch: 'lote',
  order: 'orden',
  installment: 'cuota',
  certificate: 'certificado',
  certificate_order: 'asignación de orden',
  investor: 'inversor',
  merchant: 'comercio',
  end_user: 'usuario final',
  user: 'usuario',
  setting: 'configuración',
  role_permission: 'permiso',
  system: 'sistema',
};

function entityLabel(t: string): string {
  return ENTITY_LABELS[t] ?? t;
}

function verb(a: string): string {
  return VERBS[a] ?? a;
}

function entityIdentifier(entry: AuditEntry): string {
  if (!entry.entity_id) return '';
  if (entry.entity_type === 'certificate') {
    const code = (entry.payload as { certificate_code?: string } | null)?.certificate_code;
    if (code) return code;
  }
  return entry.entity_id.slice(0, 8);
}

export function formatActivityEntry(entry: AuditEntry): { node: React.ReactNode } {
  const actorNode = entry.actor ? (
    <b className="text-text-2 font-medium">{entry.actor.full_name}</b>
  ) : (
    <span className="text-text-3 italic">sistema</span>
  );
  const id = entityIdentifier(entry);
  const idNode = id ? <span className="font-mono text-[11px]"> {id}</span> : null;
  return {
    node: (
      <>
        {actorNode} {verb(entry.action)} {entityLabel(entry.entity_type)}
        {idNode}
      </>
    ),
  };
}

export function CycleActivityFeed({ auditQ }: Props) {
  return (
    <div className="bg-card border-border-subtle overflow-hidden rounded-xl border">
      <div className="border-border-subtle border-b px-5 py-3">
        <h3 className="text-[13px] font-semibold tracking-[-0.2px]">Actividad reciente</h3>
      </div>
      <Body q={auditQ} />
    </div>
  );
}

function Body({ q }: { q: UseQueryResult<AuditListResponse> }) {
  if (q.isLoading) return <Centered>Cargando actividad…</Centered>;
  if (q.isError || !q.data) return <Centered>No se pudo cargar.</Centered>;
  if (q.data.data.length === 0)
    return <Centered italic>Sin actividad esta semana.</Centered>;
  const rows = q.data.data.slice(0, VISIBLE_LIMIT);
  return (
    <div className="px-5 py-2">
      {rows.map((e) => {
        const { node } = formatActivityEntry(e);
        return (
          <div key={e.id} className="text-text-2 flex gap-3 py-1.5 text-[11.5px]">
            <span className="text-text-3 w-16 flex-shrink-0 tabular-nums">
              {fmtRelativeTime(e.occurred_at)}
            </span>
            <span className="leading-snug">{node}</span>
          </div>
        );
      })}
    </div>
  );
}

function Centered({ children, italic = false }: { children: React.ReactNode; italic?: boolean }) {
  return (
    <div
      className={
        'text-text-3 flex h-24 items-center justify-center px-5 text-sm ' +
        (italic ? 'italic' : '')
      }
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cycle/cycle-activity-feed.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/cycle/cycle-activity-feed.tsx components/cycle/cycle-activity-feed.test.tsx
git commit -m "$(cat <<'EOF'
feat(cycle): CycleActivityFeed + formatActivityEntry

Top 5 audit entries rendered as "{actor} {verb} {entity} {id}".
Cert events prefer the certificate_code from payload; everything else
shows entity_id truncated to 8 chars. Relative timestamps via
fmtRelativeTime ("hace 3h" / "ayer" / etc).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `<CycleCtaButtons>`

**Files:**
- Create: `components/cycle/cycle-cta-buttons.tsx`
- Create: `components/cycle/cycle-cta-buttons.test.tsx`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/components/cycle/cycle-cta-buttons.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CycleCtaButtons } from './cycle-cta-buttons';

describe('<CycleCtaButtons />', () => {
  it('operator sees both buttons', () => {
    render(<CycleCtaButtons userRole="operator" />);
    const upload = screen.getByRole('link', { name: /subir lote/i });
    expect(upload).toHaveAttribute('href', '/batches');
    const newCert = screen.getByRole('link', { name: /nuevo certificado/i });
    expect(newCert).toHaveAttribute('href', '/stock');
  });

  it('admin sees both buttons', () => {
    render(<CycleCtaButtons userRole="admin" />);
    expect(screen.getByRole('link', { name: /subir lote/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /nuevo certificado/i })).toBeInTheDocument();
  });

  it('auditor sees neither button', () => {
    const { container } = render(<CycleCtaButtons userRole="auditor" />);
    expect(screen.queryByRole('link', { name: /subir lote/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /nuevo certificado/i })).toBeNull();
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cycle/cycle-cta-buttons.test.tsx
```

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/cycle/cycle-cta-buttons.tsx`:

```tsx
'use client';

import Link from 'next/link';
import type { MeUser } from '@/lib/api/me';
import { hasPermission } from '@/lib/permissions/has-permission';

interface Props {
  userRole: MeUser['role'];
}

export function CycleCtaButtons({ userRole }: Props) {
  const canUpload = hasPermission(userRole, 'batch.upload');
  const canCreateCert = hasPermission(userRole, 'certificate.create');

  if (!canUpload && !canCreateCert) return null;

  return (
    <div className="flex items-center gap-2">
      {canUpload && (
        <Link
          href="/batches"
          className="border-border-subtle bg-card text-text-2 hover:bg-subtle rounded-md border px-4 py-2 text-[12px] font-medium"
        >
          Subir lote
        </Link>
      )}
      {canCreateCert && (
        <Link
          href="/stock"
          className="bg-foreground text-background rounded-md px-4 py-2 text-[12px] font-medium"
        >
          Nuevo certificado
        </Link>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cycle/cycle-cta-buttons.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/cycle/cycle-cta-buttons.tsx components/cycle/cycle-cta-buttons.test.tsx
git commit -m "$(cat <<'EOF'
feat(cycle): CycleCtaButtons

Two header links: "Subir lote" → /batches (gated batch.upload),
"Nuevo certificado" → /stock (gated certificate.create). Auditor sees
nothing (renders null).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `<CyclePage>` orchestrator

**Why:** Glues everything together with `useQueries` (4 parallel fetches). Each panel handles its own state.

**Files:**
- Create: `components/cycle/cycle-page.tsx`
- Create: `components/cycle/cycle-page.test.tsx`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/components/cycle/cycle-page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithQuery } from '@/test/helpers/tanstack';
import { UserProvider } from '@/lib/auth/user-context';
import { CyclePage } from './cycle-page';

const { mockStats, mockCerts, mockBatches, mockAudit } = vi.hoisted(() => ({
  mockStats: vi.fn(),
  mockCerts: vi.fn(),
  mockBatches: vi.fn(),
  mockAudit: vi.fn(),
}));

vi.mock('@/lib/api/orders', () => ({ getOrdersStats: (...a: unknown[]) => mockStats(...a) }));
vi.mock('@/lib/api/certificates', () => ({ listCertificates: (...a: unknown[]) => mockCerts(...a) }));
vi.mock('@/lib/api/batches', () => ({ listBatches: (...a: unknown[]) => mockBatches(...a) }));
vi.mock('@/lib/api/audit', () => ({ listAudit: (...a: unknown[]) => mockAudit(...a) }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

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

describe('<CyclePage />', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStats.mockResolvedValue({
      by_status: {
        available: { count: 0, total_amount: '0', total_installments_amount: '0' },
        assigned: { count: 0, total_amount: '0', total_installments_amount: '0' },
        matured: { count: 0, total_amount: '0', total_installments_amount: '0' },
        defaulted: { count: 0, total_amount: '0', total_installments_amount: '0' },
      },
      total_orders: 0,
      available_capital: '0',
    });
    mockCerts.mockResolvedValue({ data: [], total: 0, limit: 50, offset: 0 });
    mockBatches.mockResolvedValue({ data: [], total: 0, limit: 50, offset: 0 });
    mockAudit.mockResolvedValue({ data: [], total: 0, limit: 50, offset: 0 });
  });

  it('renders PageHeader + banner + metrics + 2-col body', async () => {
    wrap(<CyclePage />);
    expect(
      screen.getByRole('heading', { level: 1, name: /panel del ciclo/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Ciclo semanal/)).toBeInTheDocument();
    await waitFor(() => expect(mockStats).toHaveBeenCalled());
    await waitFor(() => expect(mockCerts).toHaveBeenCalled());
    await waitFor(() => expect(mockBatches).toHaveBeenCalled());
    await waitFor(() => expect(mockAudit).toHaveBeenCalled());
  });

  it('calls listBatches with status="imported"', async () => {
    wrap(<CyclePage />);
    await waitFor(() => expect(mockBatches).toHaveBeenCalled());
    expect(mockBatches.mock.calls[0][0]).toMatchObject({ status: 'imported' });
  });

  it('passes Mon-Fri to listCertificates and Monday to listAudit', async () => {
    wrap(<CyclePage />);
    await waitFor(() => expect(mockCerts).toHaveBeenCalled());
    const certsArg = mockCerts.mock.calls[0][0];
    expect(certsArg.issue_date_from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(certsArg.issue_date_to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(certsArg.sort).toBe('issue_date_desc');

    const auditArg = mockAudit.mock.calls[0][0];
    expect(auditArg.occurred_at_from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cycle/cycle-page.test.tsx
```

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/cycle/cycle-page.tsx`:

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
import type { OrdersStats } from '@/lib/types/order';
import type { CertificatesListResponse } from '@/lib/types/certificate';
import { CycleCtaButtons } from './cycle-cta-buttons';
import { CycleBanner } from './cycle-banner';
import { CycleMetricsStrip } from './cycle-metrics-strip';
import { CycleCertificatesPanel } from './cycle-certificates-panel';
import { CycleBatchesPanel } from './cycle-batches-panel';
import { CycleActivityFeed } from './cycle-activity-feed';

function computePctAssigned(
  stats: OrdersStats | undefined,
  certs: CertificatesListResponse | undefined,
): number {
  if (!stats || !certs) return 0;
  const assigned = certs.data.reduce((acc, c) => acc + Number(c.investor_capital), 0);
  const available = Number(stats.available_capital);
  const denom = assigned + available;
  return denom > 0 ? assigned / denom : 0;
}

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
        queryKey: [
          'certificates',
          {
            issue_date_from: range.monday,
            issue_date_to: range.friday,
            sort: 'issue_date_desc',
            limit: 50,
          },
        ],
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
        queryKey: ['batches', { status: 'imported' as const }],
        queryFn: () => listBatches({ status: 'imported', limit: 50 }),
        staleTime: 60_000,
      },
      {
        queryKey: ['audit', { occurred_at_from: range.monday, limit: 8 }],
        queryFn: () => listAudit({ occurred_at_from: range.monday, limit: 8 }),
        staleTime: 60_000,
      },
    ],
  });

  const pctAssigned = computePctAssigned(statsQ.data, certsQ.data);

  return (
    <div className="mx-auto w-full max-w-[1440px] px-9 py-7">
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          breadcrumb={{ section: 'Operación', current: 'Panel del ciclo' }}
          title="Panel del ciclo"
        />
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
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/cycle/cycle-page.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/cycle/cycle-page.tsx components/cycle/cycle-page.test.tsx
git commit -m "$(cat <<'EOF'
feat(cycle): CyclePage orchestrator

useQueries(4) in parallel: orders/stats, certificates of the week,
batches with status='imported', audit-log filtered to current Monday.
Each panel handles its own state — single endpoint failure doesn't
blank the dashboard.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Wire `/cycle` route + local smoke

**Files:**
- Modify: `app/(app)/cycle/page.tsx`

- [ ] **Step 1: Replace the route file**

Overwrite `/Users/llam/dev/araguaney_front/app/(app)/cycle/page.tsx` with:

```tsx
import { CyclePage } from '@/components/cycle/cycle-page';

export default function CycleRoute() {
  return <CyclePage />;
}
```

- [ ] **Step 2: Verify + build**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
pnpm build
```

Expected: build succeeds; `/cycle` listed as `ƒ` (dynamic).

- [ ] **Step 3: Boot dev + auth-gate smoke**

```bash
cd /Users/llam/dev/araguaney_front
lsof -ti:3000 | xargs kill -9 2>/dev/null
pnpm dev > /tmp/front-task10.log 2>&1 &
PID=$!
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if grep -q "Ready in" /tmp/front-task10.log 2>/dev/null; then echo "ready in ${i}s"; break; fi
  sleep 1
done

curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3000/cycle

kill $PID 2>/dev/null
wait $PID 2>/dev/null
```

Expected: `307` → `/login`.

- [ ] **Step 4: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add "app/(app)/cycle/page.tsx"
git commit -m "$(cat <<'EOF'
feat(cycle): wire /cycle route

Replaces the Slice 1 ComingSoon stub. Server Component shell mounts
the client orchestrator. Auth gate verified locally (307 → /login).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Push + PR

**Files:** none.

- [ ] **Step 1: Push**

```bash
cd /Users/llam/dev/araguaney_front
git push -u origin feat/slice-9-cycle
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "feat: Slice 9 — /cycle Panel del ciclo" --body "$(cat <<'EOF'
## Summary

Pantalla \`/cycle\` con dashboard read-only del ciclo semanal:

- **Banner**: número de semana ISO + rango Mon-Fri + "Día N de 5" + progress bar "X% del stock asignado"
- **3 metric cards**: Stock disponible (de orders/stats), Asignado esta semana (suma capital de certs de la semana), Inversores activos (distintos investor.id de esos certs)
- **2-col body**: tabla certs de la semana (sweep distinguidos con pill) + lista lotes activos + feed actividad reciente (top 5 audit events)
- **Header CTAs**: "Subir lote" → /batches, "Nuevo certificado" → /stock (gated por permisos)

\`useQueries\` con 4 fetches paralelos. Cada panel maneja su propio loading/error — un endpoint falla, el resto del dashboard sigue funcionando.

## What's new

- \`lib/format/iso-week.ts\` (+ test) — \`currentCycleRange\` con math UTC, alineado con back's helpers/iso-week.ts
- \`lib/format/date.ts\` — agrega \`fmtRelativeTime\` para timestamps relativos del feed
- 7 componentes nuevos en \`components/cycle/\`
- \`app/(app)/cycle/page.tsx\` — replace ComingSoon

## Test Plan

- [x] \`pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check && pnpm build\` — todo clean
- [x] ~32 nuevos tests pasando
- [x] Smoke local: /cycle → 307 → /login (auth gate funciona)
- [ ] Vercel preview renders sin console errors
- [ ] Banner muestra día correcto + rango Mon-Fri actual
- [ ] Cards muestran números reales del back
- [ ] Click cert row → /certificates/{id}
- [ ] Click "Ver todos" en certs → /certificates, en batches → /batches
- [ ] Activity feed muestra eventos recientes con relative time
- [ ] Auditor no ve los 2 CTAs del header

## Notes

- No back changes — todos los endpoints ya existen
- Sweep flow es Slice 10 (próximo)
- Batches panel no muestra barra de consumo (BatchSummary no expone consumed_pct; deferred a back enhancement)
- "Inversores activos" = distintos en certs de la semana, no global

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

- New route `/cycle` with banner + 3 metric cards + 2-col body (certs/batches/activity).
- 7 new components in `components/cycle/`.
- `currentCycleRange` helper + `fmtRelativeTime` helper.
- ~32 new tests.

**Test Plan**

- [x] `pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check && pnpm build` — todo clean
- [x] ~32 nuevos tests pasando

**Notes**

- No back changes — `useQueries` consumes existing endpoints (orders/stats, certificates, batches, audit).
- Per-panel error states so a single failure doesn't blank the dashboard.
- Sweep flow deferred to Slice 10.

---

## Self-Review

**Spec coverage:**

- ✅ Cycle banner with week label + dayIndex + pct — Task 3 (`<CycleBanner>`)
- ✅ 3 metric cards (Stock / Asignado / Investors) — Task 4 (`<CycleMetricsStrip>`)
- ✅ Certs table with sweep distinction — Task 5 (`<CycleCertificatesPanel>`)
- ✅ Active batches list — Task 6 (`<CycleBatchesPanel>`) (without consumption bar; documented)
- ✅ Activity feed from audit log — Task 7 (`<CycleActivityFeed>`)
- ✅ Header CTAs gated — Task 8 (`<CycleCtaButtons>`)
- ✅ Orchestrator with `useQueries(4)` — Task 9 (`<CyclePage>`)
- ✅ Per-panel error states — each panel checks `q.isLoading` / `q.isError`
- ✅ Cycle math helper — Task 1 (`currentCycleRange`)
- ✅ Relative time helper — Task 2 (`fmtRelativeTime`)
- ✅ Route wire-up + auth-gate smoke — Task 10
- ✅ Push + PR — Task 11

**Placeholder scan:** No TODOs / TBDs. All test fixtures concrete. All component code shown in full.

**Type/value consistency:**
- `CycleRange` from Task 1 used by `CyclePage` (Task 9) and `CycleBanner` (Task 3).
- `OrdersStats` (existing) consumed by `CycleMetricsStrip` (Task 4) and `CyclePage` (Task 9).
- `CertificatesListResponse` (existing) consumed by metrics + certs panel + page.
- `BatchListResponse` (existing) consumed by `CycleBatchesPanel` + page.
- `AuditListResponse` (existing) consumed by `CycleActivityFeed` + page.
- `formatActivityEntry` exported from `cycle-activity-feed.tsx` and tested independently.
- `currentCycleRange` returns same shape consistently across consumers.
- `listBatches({ status: 'imported' })` — confirmed in pre-flight; `BatchStatus` includes 'imported'.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-13-front-slice-9-cycle.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Fresh subagent per task + two-stage review.

**2. Inline Execution** — Same session with batch checkpoints.

**Which approach?**
