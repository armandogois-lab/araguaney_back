# araguaney_front Slice 8 — `/audit` log viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/audit` with a paginated list of `cfb.audit_log` events plus filters (entity_type + action + date range) and a row-click modal showing actor + IP + user-agent + payload JSON pretty-printed.

**Architecture:** One route at `/audit` with a Server Component shell mounting `<AuditPage>` client orchestrator. List uses TanStack Query (`['audit', query]`). Detail is a modal that receives the full entry from the row click. No mutations. Permission `audit.read` is universal (all three roles); no visibility gating.

**Tech Stack:** Next.js 16 App Router, TanStack Query v5, hand-typed shapes, Vitest + Testing Library.

**Spec:** `/Users/llam/dev/araguaney_back/docs/superpowers/specs/2026-05-13-front-slice-8-audit-design.md`

**Working directory note:** all front code lives in `/Users/llam/dev/araguaney_front/`. Plan and spec live in `/Users/llam/dev/araguaney_back/docs/`. Implementer must `cd /Users/llam/dev/araguaney_front` for any task command.

**Pre-req branch:** Work on `feat/slice-8-audit` (Task 1 creates this from `main`).

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `lib/types/audit.ts` | create | `AuditEntityType`, `AuditAction`, `AuditActor`, `AuditEntry`, `AuditListResponse` |
| `lib/format/date.ts` | modify | Add `fmtDateTime` helper (UTC math, deterministic) |
| `lib/format/date.test.ts` | modify | Add 3 tests for `fmtDateTime` |
| `lib/api/audit.ts` | create | `listAudit(query)` Server Action — GET `/api/audit` |
| `lib/api/audit.test.ts` | create | 3 tests: no-params, all-filters, default-pagination |
| `components/audit/audit-action-pill.tsx` (+ test) | create | Action → variant + Spanish label, fallback neutral |
| `components/audit/audit-entity-link.tsx` (+ test) | create | Conditional link to `/certificates/{id}` only when entity_type=certificate |
| `components/audit/audit-row.tsx` (+ test) | create | `<tr>` with 6 columns + click → onSelect |
| `components/audit/audit-filters.tsx` (+ test) | create | Entity_type pills + "Otros" select + action pills + date inputs |
| `components/audit/audit-table.tsx` (+ test) | create | `useQuery(['audit', query])` + 50/page paginación + states |
| `components/audit/audit-detail-modal.tsx` (+ test) | create | Backdrop + header + actor block + payload pre-printed |
| `components/audit/audit-page.tsx` (+ test) | create | Orchestrator: header + filters + table + modal |
| `app/(app)/audit/page.tsx` | modify | Replace ComingSoon with `<AuditPage />` |

**Total:** 16 new files (7 components + 7 tests + 1 type file + 1 API + 1 API test) + 3 modifications (`app/(app)/audit/page.tsx`, `lib/format/date.ts`, `lib/format/date.test.ts`). ~31 tests new.

**Manual operational tasks:**

| Action | Owner | When |
|---|---|---|
| Push branch + open PR | controller | Task 12 |
| Review + merge | user | After Task 12 |
| Verify Vercel deploy + visual smoke | user | Post-merge |

---

## Task 1: Branch + `lib/types/audit.ts`

**Why:** Foundation types. No logic, no tests needed for the types themselves (TypeScript verifies them).

**Files:**
- Create: `lib/types/audit.ts`

- [ ] **Step 1: Create branch from main**

```bash
cd /Users/llam/dev/araguaney_front
git fetch origin --prune
git checkout main
git pull origin main
git checkout -b feat/slice-8-audit
```

- [ ] **Step 2: Write the file**

Create `/Users/llam/dev/araguaney_front/lib/types/audit.ts`:

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

export type AuditAction = 'create' | 'update' | 'cancel' | 'grant' | 'revoke' | (string & {});

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

The `(string & {})` trick on `AuditAction` keeps autocomplete for the 5 known actions while still accepting any string the back might add later.

- [ ] **Step 3: Verify typecheck clean**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck
```

Expected: clean. No code consumes these types yet, so nothing else needs to change.

- [ ] **Step 4: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add lib/types/audit.ts
git commit -m "$(cat <<'EOF'
feat(types): AuditEntry + AuditListResponse + helpers

Wire shapes from GET /api/audit. Backed by cfb.audit_log: 12 entity
types, 5 observed actions (create/update/cancel/grant/revoke) plus
forward-compat for future actions, optional actor (system events
have null), payload as unknown jsonb.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `fmtDateTime` helper

**Why:** The audit list shows full date + time (DD/MM/YYYY HH:MM:SS). Existing `fmtDate` returns date only.

**Files:**
- Modify: `lib/format/date.ts`
- Modify: `lib/format/date.test.ts`

- [ ] **Step 1: Failing tests (append)**

Append to `/Users/llam/dev/araguaney_front/lib/format/date.test.ts` (after the existing `describe('fmtDate', ...)` block):

```ts
import { fmtDateTime } from './date';

describe('fmtDateTime', () => {
  it('formats ISO timestamps as DD/MM/YYYY HH:MM:SS in UTC', () => {
    expect(fmtDateTime('2026-04-20T14:30:00.000Z')).toBe('20/04/2026 14:30:00');
    expect(fmtDateTime('2026-01-01T00:00:00.000Z')).toBe('01/01/2026 00:00:00');
    expect(fmtDateTime('2026-12-31T23:59:59.000Z')).toBe('31/12/2026 23:59:59');
  });

  it('pads single-digit hours, minutes, seconds', () => {
    expect(fmtDateTime('2026-05-13T05:07:09.000Z')).toBe('13/05/2026 05:07:09');
  });

  it('returns "—" for null, undefined, empty, or invalid', () => {
    expect(fmtDateTime(null)).toBe('—');
    expect(fmtDateTime(undefined)).toBe('—');
    expect(fmtDateTime('')).toBe('—');
    expect(fmtDateTime('not-a-date')).toBe('—');
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/format/date.test.ts
```

Expected: 3 new failures (`fmtDateTime` not exported).

- [ ] **Step 3: Implement**

Append to `/Users/llam/dev/araguaney_front/lib/format/date.ts`:

```ts
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  const HH = String(d.getUTCHours()).padStart(2, '0');
  const MM = String(d.getUTCMinutes()).padStart(2, '0');
  const SS = String(d.getUTCSeconds()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${HH}:${MM}:${SS}`;
}
```

- [ ] **Step 4: Run + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/format/date.test.ts
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

All four clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add lib/format/date.ts lib/format/date.test.ts
git commit -m "$(cat <<'EOF'
feat(format): fmtDateTime helper

UTC math (matches existing fmtDate). Returns "—" for null/undefined/
invalid. For the /audit list's first column (DD/MM/YYYY HH:MM:SS).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `lib/api/audit.ts` — Server Action

**Why:** The single API entry point for `/audit`. Mirrors `lib/api/investors.ts` and `lib/api/certificates.ts` patterns.

**Files:**
- Create: `lib/api/audit.ts`
- Create: `lib/api/audit.test.ts`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/lib/api/audit.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));

vi.mock('./client', () => ({
  apiFetch: (...a: unknown[]) => mockApiFetch(...a),
}));

import { listAudit } from './audit';

describe('listAudit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('GETs /api/audit with no params', async () => {
    mockApiFetch.mockResolvedValueOnce({ data: [], total: 0, limit: 50, offset: 0 });
    await listAudit({});
    expect(mockApiFetch).toHaveBeenCalledWith('/api/audit', { method: 'GET' });
  });

  it('appends every supported filter', async () => {
    mockApiFetch.mockResolvedValueOnce({ data: [], total: 0, limit: 50, offset: 0 });
    await listAudit({
      limit: 50,
      offset: 100,
      entity_type: 'certificate',
      action: 'cancel',
      occurred_at_from: '2026-05-01',
      occurred_at_to: '2026-05-31',
    });
    const path = mockApiFetch.mock.calls[0][0] as string;
    expect(path).toContain('limit=50');
    expect(path).toContain('offset=100');
    expect(path).toContain('entity_type=certificate');
    expect(path).toContain('action=cancel');
    expect(path).toContain('occurred_at_from=2026-05-01');
    expect(path).toContain('occurred_at_to=2026-05-31');
  });

  it('returns the typed response', async () => {
    const fake = {
      data: [
        {
          id: 'evt-1',
          occurred_at: '2026-05-13T10:00:00Z',
          actor: { id: 'u-1', email: 'op@x.com', full_name: 'Op' },
          action: 'create',
          entity_type: 'certificate',
          entity_id: 'cert-uuid',
          ip_address: '1.2.3.4',
          user_agent: 'Mozilla',
          payload: { code: 'C4572A' },
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    };
    mockApiFetch.mockResolvedValueOnce(fake);
    const result = await listAudit({});
    expect(result).toEqual(fake);
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/api/audit.test.ts
```

Expected: import error — module doesn't exist.

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/lib/api/audit.ts`:

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

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/api/audit.test.ts
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add lib/api/audit.ts lib/api/audit.test.ts
git commit -m "$(cat <<'EOF'
feat(api): listAudit Server Action

GET /api/audit with optional entity_type/action/date-range filters.
Same rethrowWithMessage pattern as the rest of the api/ folder.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `<AuditActionPill>`

**Files:**
- Create: `components/audit/audit-action-pill.tsx`
- Create: `components/audit/audit-action-pill.test.tsx`

- [ ] **Step 1: Failing test**

```bash
cd /Users/llam/dev/araguaney_front
mkdir -p components/audit
```

Create `/Users/llam/dev/araguaney_front/components/audit/audit-action-pill.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuditActionPill } from './audit-action-pill';

describe('<AuditActionPill />', () => {
  it('shows "Crear" with success tone for create', () => {
    render(<AuditActionPill action="create" />);
    expect(screen.getByText('Crear')).toBeInTheDocument();
  });

  it('shows "Actualizar" with info tone for update', () => {
    render(<AuditActionPill action="update" />);
    expect(screen.getByText('Actualizar')).toBeInTheDocument();
  });

  it('shows "Cancelar" with danger tone for cancel', () => {
    render(<AuditActionPill action="cancel" />);
    expect(screen.getByText('Cancelar')).toBeInTheDocument();
  });

  it('shows "Otorgar" for grant and "Revocar" for revoke', () => {
    const { rerender } = render(<AuditActionPill action="grant" />);
    expect(screen.getByText('Otorgar')).toBeInTheDocument();
    rerender(<AuditActionPill action="revoke" />);
    expect(screen.getByText('Revocar')).toBeInTheDocument();
  });

  it('falls back to raw action string for unknown actions', () => {
    render(<AuditActionPill action="something_new" />);
    expect(screen.getByText('something_new')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/audit/audit-action-pill.test.tsx
```

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/audit/audit-action-pill.tsx`:

```tsx
import { Pill, type PillVariant } from '@/components/ui/pill';

const MAP: Record<string, { variant: PillVariant; label: string }> = {
  create: { variant: 'success', label: 'Crear' },
  update: { variant: 'info', label: 'Actualizar' },
  cancel: { variant: 'danger', label: 'Cancelar' },
  grant: { variant: 'success', label: 'Otorgar' },
  revoke: { variant: 'warn', label: 'Revocar' },
};

export function AuditActionPill({ action }: { action: string }) {
  const m = MAP[action] ?? { variant: 'neutral' as PillVariant, label: action };
  return <Pill variant={m.variant}>{m.label}</Pill>;
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/audit/audit-action-pill.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/audit/audit-action-pill.tsx components/audit/audit-action-pill.test.tsx
git commit -m "$(cat <<'EOF'
feat(audit): AuditActionPill

Maps the 5 observed audit actions to Spanish labels + Pill variants.
Falls back to raw action string + neutral variant for any new action
the back might introduce.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `<AuditEntityLink>`

**Files:**
- Create: `components/audit/audit-entity-link.tsx`
- Create: `components/audit/audit-entity-link.test.tsx`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/components/audit/audit-entity-link.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuditEntityLink } from './audit-entity-link';

describe('<AuditEntityLink />', () => {
  it('renders a link to /certificates/{id} when entity_type is certificate', () => {
    render(<AuditEntityLink entityType="certificate" entityId="cert-uuid-1" />);
    const link = screen.getByRole('link', { name: 'cert-uuid-1' });
    expect(link).toHaveAttribute('href', '/certificates/cert-uuid-1');
  });

  it('renders plain mono text for batch entity type', () => {
    render(<AuditEntityLink entityType="batch" entityId="batch-uuid" />);
    expect(screen.getByText('batch-uuid')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders plain mono text for investor entity type', () => {
    render(<AuditEntityLink entityType="investor" entityId="inv-uuid" />);
    expect(screen.getByText('inv-uuid')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders "—" when entityId is null', () => {
    render(<AuditEntityLink entityType="system" entityId={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/audit/audit-entity-link.test.tsx
```

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/audit/audit-entity-link.tsx`:

```tsx
import Link from 'next/link';
import type { AuditEntityType } from '@/lib/types/audit';

interface Props {
  entityType: AuditEntityType;
  entityId: string | null;
}

export function AuditEntityLink({ entityType, entityId }: Props) {
  if (!entityId) return <span className="text-text-3">—</span>;
  if (entityType === 'certificate') {
    return (
      <Link
        href={`/certificates/${entityId}`}
        className="text-text-2 font-mono text-[11.5px] hover:underline"
      >
        {entityId}
      </Link>
    );
  }
  return <span className="text-text-2 font-mono text-[11.5px]">{entityId}</span>;
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/audit/audit-entity-link.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/audit/audit-entity-link.tsx components/audit/audit-entity-link.test.tsx
git commit -m "$(cat <<'EOF'
feat(audit): AuditEntityLink

Conditional link: certificate entity_ids navigate to /certificates/{id};
other entity types render as plain mono text. null → "—".

Add more entity links here when /batches/[id], /investors/[id], etc.
detail pages ship.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `<AuditRow>`

**Files:**
- Create: `components/audit/audit-row.tsx`
- Create: `components/audit/audit-row.test.tsx`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/components/audit/audit-row.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AuditRow } from './audit-row';
import type { AuditEntry } from '@/lib/types/audit';

function mockEntry(over: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 'evt-1',
    occurred_at: '2026-05-13T14:30:00.000Z',
    actor: { id: 'u-1', email: 'maria@cashea.app', full_name: 'María Rodríguez' },
    action: 'create',
    entity_type: 'certificate',
    entity_id: 'cert-uuid-1',
    ip_address: '190.123.45.67',
    user_agent: 'Mozilla/5.0',
    payload: { code: 'C4572A' },
    ...over,
  };
}

describe('<AuditRow />', () => {
  function wrap(row: React.ReactElement) {
    return render(<table><tbody>{row}</tbody></table>);
  }

  it('renders all columns', () => {
    wrap(<AuditRow entry={mockEntry()} onSelect={vi.fn()} />);
    expect(screen.getByText('13/05/2026 14:30:00')).toBeInTheDocument();
    expect(screen.getByText('María Rodríguez')).toBeInTheDocument();
    expect(screen.getByText('Crear')).toBeInTheDocument();
    expect(screen.getByText('certificate')).toBeInTheDocument();
    expect(screen.getByText('cert-uuid-1')).toBeInTheDocument();
    expect(screen.getByText('190.123.45.67')).toBeInTheDocument();
  });

  it('fires onSelect with the entry on click', () => {
    const onSelect = vi.fn();
    const entry = mockEntry();
    wrap(<AuditRow entry={entry} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Crear'));
    expect(onSelect).toHaveBeenCalledWith(entry);
  });

  it('shows "sistema" when actor is null', () => {
    wrap(<AuditRow entry={mockEntry({ actor: null })} onSelect={vi.fn()} />);
    expect(screen.getByText('sistema')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/audit/audit-row.test.tsx
```

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/audit/audit-row.tsx`:

```tsx
'use client';

import { fmtDateTime } from '@/lib/format/date';
import type { AuditEntry } from '@/lib/types/audit';
import { AuditActionPill } from './audit-action-pill';
import { AuditEntityLink } from './audit-entity-link';

interface Props {
  entry: AuditEntry;
  onSelect: (entry: AuditEntry) => void;
}

export function AuditRow({ entry, onSelect }: Props) {
  return (
    <tr
      onClick={() => onSelect(entry)}
      className="border-border-soft hover:bg-subtle cursor-pointer border-b transition-colors"
    >
      <td className="num px-4 py-3 text-[11.5px]">{fmtDateTime(entry.occurred_at)}</td>
      <td className="max-w-[220px] truncate px-4 py-3 text-[12px]" title={entry.actor?.email ?? ''}>
        {entry.actor ? entry.actor.full_name : <span className="text-text-3 italic">sistema</span>}
      </td>
      <td className="px-4 py-3">
        <AuditActionPill action={entry.action} />
      </td>
      <td className="text-text-2 px-4 py-3 text-[11.5px]">{entry.entity_type}</td>
      <td className="max-w-[200px] truncate px-4 py-3">
        <AuditEntityLink entityType={entry.entity_type} entityId={entry.entity_id} />
      </td>
      <td className="text-text-3 max-w-[140px] truncate px-4 py-3 font-mono text-[11px]">
        {entry.ip_address ?? '—'}
      </td>
    </tr>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/audit/audit-row.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/audit/audit-row.tsx components/audit/audit-row.test.tsx
git commit -m "$(cat <<'EOF'
feat(audit): AuditRow

Six columns: fecha (DD/MM/YYYY HH:MM:SS), actor (or "sistema" italic),
acción (pill), entity_type, entity_id (link for certs only), ip.
Whole row is clickable → onSelect.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `<AuditFilters>`

**Files:**
- Create: `components/audit/audit-filters.tsx`
- Create: `components/audit/audit-filters.test.tsx`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/components/audit/audit-filters.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AuditFilters, type AuditFiltersValue } from './audit-filters';

const DEFAULT: AuditFiltersValue = {
  entityType: 'all',
  action: 'all',
  dateFrom: '2026-04-13',
  dateTo: '2026-05-13',
};

describe('<AuditFilters />', () => {
  it('renders entity_type pills with "Todos" active by default', () => {
    render(<AuditFilters value={DEFAULT} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Todos' })).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('button', { name: 'Certificate' })).toHaveAttribute(
      'data-active',
      'false',
    );
  });

  it('clicking "Certificate" emits entityType: "certificate"', () => {
    const onChange = vi.fn();
    render(<AuditFilters value={DEFAULT} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Certificate' }));
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT, entityType: 'certificate' });
  });

  it('clicking action pill "Actualizar" emits action: "update"', () => {
    const onChange = vi.fn();
    render(<AuditFilters value={DEFAULT} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT, action: 'update' });
  });

  it('changing date inputs emits dateFrom / dateTo', () => {
    const onChange = vi.fn();
    render(<AuditFilters value={DEFAULT} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/desde/i), { target: { value: '2026-05-01' } });
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT, dateFrom: '2026-05-01' });
    fireEvent.change(screen.getByLabelText(/hasta/i), { target: { value: '2026-05-31' } });
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT, dateTo: '2026-05-31' });
  });

  it('selecting from "Otros" dropdown emits entityType', () => {
    const onChange = vi.fn();
    render(<AuditFilters value={DEFAULT} onChange={onChange} />);
    const select = screen.getByLabelText(/otros tipos/i);
    fireEvent.change(select, { target: { value: 'installment' } });
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT, entityType: 'installment' });
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/audit/audit-filters.test.tsx
```

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/audit/audit-filters.tsx`:

```tsx
'use client';

import type { AuditEntityType } from '@/lib/types/audit';

export type AuditEntityFilter = AuditEntityType | 'all';
export type AuditActionFilter = 'create' | 'update' | 'cancel' | 'grant' | 'revoke' | 'all';

export interface AuditFiltersValue {
  entityType: AuditEntityFilter;
  action: AuditActionFilter;
  dateFrom: string;
  dateTo: string;
}

interface Props {
  value: AuditFiltersValue;
  onChange: (next: AuditFiltersValue) => void;
}

const ENTITY_PILLS: Array<{ value: AuditEntityFilter; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'certificate', label: 'Certificate' },
  { value: 'investor', label: 'Investor' },
  { value: 'batch', label: 'Batch' },
  { value: 'order', label: 'Order' },
  { value: 'setting', label: 'Setting' },
  { value: 'user', label: 'User' },
  { value: 'role_permission', label: 'Role-permission' },
];

const OTROS_OPTIONS: Array<{ value: AuditEntityType; label: string }> = [
  { value: 'installment', label: 'Installment' },
  { value: 'certificate_order', label: 'Certificate order' },
  { value: 'merchant', label: 'Merchant' },
  { value: 'end_user', label: 'End user' },
  { value: 'system', label: 'System' },
];

const ACTION_PILLS: Array<{ value: AuditActionFilter; label: string }> = [
  { value: 'all', label: 'Todas' },
  { value: 'create', label: 'Crear' },
  { value: 'update', label: 'Actualizar' },
  { value: 'cancel', label: 'Cancelar' },
  { value: 'grant', label: 'Otorgar' },
  { value: 'revoke', label: 'Revocar' },
];

export function AuditFilters({ value, onChange }: Props) {
  const otrosValues = new Set(OTROS_OPTIONS.map((o) => o.value));
  const otrosSelected = otrosValues.has(value.entityType as AuditEntityType)
    ? (value.entityType as AuditEntityType)
    : '';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-text-3 mr-1 text-[11px]">Entidad</span>
        <div className="border-border-subtle flex flex-wrap items-center gap-1 rounded-md border p-1">
          {ENTITY_PILLS.map((opt) => {
            const active = value.entityType === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                data-active={active}
                onClick={() => onChange({ ...value, entityType: opt.value })}
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
        <select
          aria-label="Otros tipos"
          value={otrosSelected}
          onChange={(e) => {
            const next = e.target.value;
            if (next === '') return;
            onChange({ ...value, entityType: next as AuditEntityType });
          }}
          className="border-border-subtle bg-card rounded-md border px-2 py-1 text-[12px]"
        >
          <option value="">Otros…</option>
          {OTROS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-text-3 mr-1 text-[11px]">Acción</span>
        <div className="border-border-subtle flex items-center gap-1 rounded-md border p-1">
          {ACTION_PILLS.map((opt) => {
            const active = value.action === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                data-active={active}
                onClick={() => onChange({ ...value, action: opt.value })}
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
        <label className="ml-2 flex items-center gap-2 text-[11px]">
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
    </div>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/audit/audit-filters.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/audit/audit-filters.tsx components/audit/audit-filters.test.tsx
git commit -m "$(cat <<'EOF'
feat(audit): AuditFilters

Two pill groups + 1 dropdown + 2 date inputs:
- Entity_type pills (Todos / 7 most-used) + "Otros…" dropdown for 5 less-used
- Action pills (Todas / 5 known actions)
- Date inputs (Desde / Hasta)

Pure controlled component; parent owns value.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `<AuditTable>`

**Files:**
- Create: `components/audit/audit-table.tsx`
- Create: `components/audit/audit-table.test.tsx`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/components/audit/audit-table.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithQuery } from '@/test/helpers/tanstack';
import { AuditTable } from './audit-table';
import type { AuditFiltersValue } from './audit-filters';
import type { AuditEntry } from '@/lib/types/audit';

const { mockList } = vi.hoisted(() => ({ mockList: vi.fn() }));

vi.mock('@/lib/api/audit', () => ({
  listAudit: (...a: unknown[]) => mockList(...a),
}));

function entry(over: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 'evt-' + Math.random(),
    occurred_at: '2026-05-13T10:00:00Z',
    actor: { id: 'u-1', email: 'op@x.com', full_name: 'Op' },
    action: 'create',
    entity_type: 'certificate',
    entity_id: 'cert-1',
    ip_address: '1.2.3.4',
    user_agent: 'Mozilla',
    payload: {},
    ...over,
  };
}

const FILTERS: AuditFiltersValue = {
  entityType: 'all',
  action: 'all',
  dateFrom: '2026-04-13',
  dateTo: '2026-05-13',
};

describe('<AuditTable />', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows skeleton while fetching', () => {
    mockList.mockImplementation(() => new Promise(() => {}));
    renderWithQuery(
      <AuditTable filters={FILTERS} page={0} onPageChange={() => {}} onSelectEntry={() => {}} />,
    );
    expect(screen.getByText(/cargando/i)).toBeInTheDocument();
  });

  it('shows empty state when no results', async () => {
    mockList.mockResolvedValueOnce({ data: [], total: 0, limit: 50, offset: 0 });
    renderWithQuery(
      <AuditTable filters={FILTERS} page={0} onPageChange={() => {}} onSelectEntry={() => {}} />,
    );
    await waitFor(() => expect(screen.getByText(/sin eventos/i)).toBeInTheDocument());
  });

  it('shows error state on failure', async () => {
    mockList.mockRejectedValueOnce(new Error('boom'));
    renderWithQuery(
      <AuditTable filters={FILTERS} page={0} onPageChange={() => {}} onSelectEntry={() => {}} />,
    );
    await waitFor(() => expect(screen.getByText(/no se pudieron cargar/i)).toBeInTheDocument());
  });

  it('renders rows + pagination footer', async () => {
    mockList.mockResolvedValueOnce({
      data: [entry(), entry({ id: 'evt-2', action: 'update' })],
      total: 100,
      limit: 50,
      offset: 0,
    });
    renderWithQuery(
      <AuditTable filters={FILTERS} page={0} onPageChange={() => {}} onSelectEntry={() => {}} />,
    );
    await waitFor(() => expect(screen.getByText(/1[–-]50 de 100/)).toBeInTheDocument());
    expect(screen.getByText('Crear')).toBeInTheDocument();
    expect(screen.getByText('Actualizar')).toBeInTheDocument();
  });

  it('translates entityType="all" to undefined in the listAudit call', async () => {
    mockList.mockResolvedValueOnce({ data: [], total: 0, limit: 50, offset: 0 });
    renderWithQuery(
      <AuditTable filters={FILTERS} page={0} onPageChange={() => {}} onSelectEntry={() => {}} />,
    );
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    expect(mockList.mock.calls[0][0].entity_type).toBeUndefined();
    expect(mockList.mock.calls[0][0].action).toBeUndefined();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/audit/audit-table.test.tsx
```

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/audit/audit-table.tsx`:

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { listAudit, type ListAuditQuery } from '@/lib/api/audit';
import type { AuditEntry } from '@/lib/types/audit';
import { AuditRow } from './audit-row';
import type { AuditFiltersValue } from './audit-filters';

const PAGE_LIMIT = 50;

interface Props {
  filters: AuditFiltersValue;
  page: number;
  onPageChange: (next: number) => void;
  onSelectEntry: (entry: AuditEntry) => void;
}

function buildQuery(filters: AuditFiltersValue, page: number): ListAuditQuery {
  return {
    limit: PAGE_LIMIT,
    offset: page * PAGE_LIMIT,
    entity_type: filters.entityType === 'all' ? undefined : filters.entityType,
    action: filters.action === 'all' ? undefined : filters.action,
    occurred_at_from: filters.dateFrom || undefined,
    occurred_at_to: filters.dateTo || undefined,
  };
}

export function AuditTable({ filters, page, onPageChange, onSelectEntry }: Props) {
  const query = buildQuery(filters, page);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['audit', query],
    queryFn: () => listAudit(query),
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
            <Th>Fecha</Th>
            <Th>Actor</Th>
            <Th>Acción</Th>
            <Th>Entidad</Th>
            <Th>ID</Th>
            <Th>IP</Th>
          </tr>
        </thead>
        <tbody>
          {data.data.map((e) => (
            <AuditRow key={e.id} entry={e} onSelect={onSelectEntry} />
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

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="text-text-3 border-border-subtle border-b px-4 py-2.5 text-left text-[9.5px] font-medium tracking-[0.7px] uppercase">
      {children}
    </th>
  );
}

function Skeleton() {
  return (
    <div className="border-border-subtle bg-card flex h-64 items-center justify-center rounded-xl border">
      <div className="text-text-3 text-sm">Cargando eventos…</div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="border-border-subtle bg-card flex h-64 flex-col items-center justify-center gap-3 rounded-xl border">
      <div className="text-text-3 text-sm">No se pudieron cargar los eventos.</div>
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
      <div className="text-text-3 text-center text-sm">Sin eventos en este rango.</div>
    </div>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/audit/audit-table.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/audit/audit-table.tsx components/audit/audit-table.test.tsx
git commit -m "$(cat <<'EOF'
feat(audit): AuditTable

useQuery(['audit', query]) with 50/page pagination. Loading / empty /
error states + footer "Mostrando N–M de total" with prev/next.
entityType='all' and action='all' translate to undefined.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `<AuditDetailModal>`

**Files:**
- Create: `components/audit/audit-detail-modal.tsx`
- Create: `components/audit/audit-detail-modal.test.tsx`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/components/audit/audit-detail-modal.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AuditDetailModal } from './audit-detail-modal';
import type { AuditEntry } from '@/lib/types/audit';

function mockEntry(over: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 'evt-1',
    occurred_at: '2026-05-13T14:30:00.000Z',
    actor: { id: 'u-1', email: 'maria@cashea.app', full_name: 'María Rodríguez' },
    action: 'create',
    entity_type: 'certificate',
    entity_id: 'cert-uuid-1',
    ip_address: '190.123.45.67',
    user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    payload: { code: 'C4572A', capital: '100000' },
    ...over,
  };
}

describe('<AuditDetailModal />', () => {
  it('renders header with action + entity_type + datetime', () => {
    render(<AuditDetailModal entry={mockEntry()} onClose={vi.fn()} />);
    expect(screen.getByText(/CREATE.*certificate/i)).toBeInTheDocument();
    expect(screen.getByText('13/05/2026 14:30:00')).toBeInTheDocument();
  });

  it('renders actor info', () => {
    render(<AuditDetailModal entry={mockEntry()} onClose={vi.fn()} />);
    expect(screen.getByText(/María Rodríguez/i)).toBeInTheDocument();
    expect(screen.getByText(/maria@cashea\.app/i)).toBeInTheDocument();
    expect(screen.getByText('190.123.45.67')).toBeInTheDocument();
  });

  it('shows "sistema" + "—" when actor and IP are null', () => {
    render(
      <AuditDetailModal
        entry={mockEntry({ actor: null, ip_address: null, user_agent: null })}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/sistema/i)).toBeInTheDocument();
  });

  it('renders payload as pretty-printed JSON', () => {
    render(<AuditDetailModal entry={mockEntry()} onClose={vi.fn()} />);
    const pre = screen.getByText(/"code": "C4572A"/);
    expect(pre).toBeInTheDocument();
    expect(pre).toHaveTextContent(/"capital": "100000"/);
  });

  it('shows fallback when payload is empty object', () => {
    render(<AuditDetailModal entry={mockEntry({ payload: {} })} onClose={vi.fn()} />);
    expect(screen.getByText(/sin datos adicionales/i)).toBeInTheDocument();
  });

  it('shows fallback when payload is null', () => {
    render(<AuditDetailModal entry={mockEntry({ payload: null })} onClose={vi.fn()} />);
    expect(screen.getByText(/sin datos adicionales/i)).toBeInTheDocument();
  });

  it('clicking backdrop calls onClose', () => {
    const onClose = vi.fn();
    const { container } = render(<AuditDetailModal entry={mockEntry()} onClose={onClose} />);
    fireEvent.click(container.querySelector('[data-testid="audit-modal-backdrop"]')!);
    expect(onClose).toHaveBeenCalled();
  });

  it('clicking × close button calls onClose', () => {
    const onClose = vi.fn();
    render(<AuditDetailModal entry={mockEntry()} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /^×$/ }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/audit/audit-detail-modal.test.tsx
```

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/audit/audit-detail-modal.tsx`:

```tsx
'use client';

import { fmtDateTime } from '@/lib/format/date';
import type { AuditEntry } from '@/lib/types/audit';

interface Props {
  entry: AuditEntry;
  onClose: () => void;
}

function isEmptyPayload(payload: unknown): boolean {
  if (payload === null || payload === undefined) return true;
  if (typeof payload !== 'object') return false;
  return Object.keys(payload as object).length === 0;
}

export function AuditDetailModal({ entry, onClose }: Props) {
  const payloadEmpty = isEmptyPayload(entry.payload);

  return (
    <div
      data-testid="audit-modal-backdrop"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-card mt-16 w-full max-w-[640px] overflow-hidden rounded-xl"
      >
        <header className="border-border-subtle flex items-start justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-[16px] font-semibold tracking-[-0.2px]">
              {entry.action.toUpperCase()} · {entry.entity_type}
            </h2>
            <div className="text-text-3 mt-1 font-mono text-[11.5px]">
              {fmtDateTime(entry.occurred_at)}
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

        <div className="flex flex-col gap-5 px-6 py-5">
          <Block title="QUIÉN">
            <KV
              k="Actor"
              v={
                entry.actor ? (
                  <>
                    {entry.actor.full_name}{' '}
                    <span className="text-text-3">({entry.actor.email})</span>
                  </>
                ) : (
                  <span className="text-text-3 italic">sistema</span>
                )
              }
            />
            <KV k="IP" v={entry.ip_address ?? '—'} mono />
            <KV
              k="User-agent"
              v={entry.user_agent ?? '—'}
              mono
              last
            />
          </Block>

          <Block title="QUÉ">
            {payloadEmpty ? (
              <div className="text-text-3 py-2 text-[11px] italic">
                Sin datos adicionales en el payload.
              </div>
            ) : (
              <pre className="bg-subtle border-border-soft max-h-[400px] overflow-auto rounded-md border p-3 font-mono text-[11px] break-all whitespace-pre-wrap">
                {JSON.stringify(entry.payload, null, 2)}
              </pre>
            )}
          </Block>
        </div>

        <div className="border-border-subtle bg-card flex items-center justify-end gap-2 border-t px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="border-border-subtle bg-card text-text-2 hover:bg-subtle rounded-md border px-3 py-1.5 text-[12px] font-medium"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-text-3 mb-2 text-[10px] uppercase tracking-wide">{title}</div>
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
        'flex items-start justify-between gap-3 py-1.5 text-[12px] ' +
        (last ? '' : 'border-border-soft border-b')
      }
    >
      <span className="text-text-3 flex-shrink-0">{k}</span>
      <span className={'text-text-2 max-w-[60%] text-right break-all ' + (mono ? 'font-mono text-[11px]' : '')}>
        {v}
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/audit/audit-detail-modal.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/audit/audit-detail-modal.tsx components/audit/audit-detail-modal.test.tsx
git commit -m "$(cat <<'EOF'
feat(audit): AuditDetailModal

Backdrop + header (action + entity_type + datetime) + 2 blocks:
QUIÉN (actor + IP + user-agent) and QUÉ (payload pretty-printed JSON
or fallback "sin datos adicionales"). Read-only, no mutations.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: `<AuditPage>` orchestrator

**Files:**
- Create: `components/audit/audit-page.tsx`
- Create: `components/audit/audit-page.test.tsx`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/components/audit/audit-page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithQuery } from '@/test/helpers/tanstack';
import { AuditPage } from './audit-page';
import type { AuditEntry } from '@/lib/types/audit';

const { mockList } = vi.hoisted(() => ({ mockList: vi.fn() }));

vi.mock('@/lib/api/audit', () => ({
  listAudit: (...a: unknown[]) => mockList(...a),
}));

function entry(over: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 'evt-1',
    occurred_at: '2026-05-13T10:00:00.000Z',
    actor: { id: 'u-1', email: 'op@x.com', full_name: 'María' },
    action: 'create',
    entity_type: 'certificate',
    entity_id: 'cert-1',
    ip_address: '1.2.3.4',
    user_agent: 'Mozilla',
    payload: { code: 'C4572A' },
    ...over,
  };
}

describe('<AuditPage />', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue({ data: [entry()], total: 1, limit: 50, offset: 0 });
  });

  it('renders header + filters + table with default 30-day range', async () => {
    renderWithQuery(<AuditPage />);
    expect(screen.getByRole('heading', { level: 1, name: /auditor[íi]a/i })).toBeInTheDocument();
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(1));
    const arg = mockList.mock.calls[0][0];
    expect(typeof arg.occurred_at_from).toBe('string');
    expect(typeof arg.occurred_at_to).toBe('string');
    expect(arg.occurred_at_from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(arg.occurred_at_to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('clicking a row opens the detail modal', async () => {
    renderWithQuery(<AuditPage />);
    await waitFor(() => expect(screen.getByText('María')).toBeInTheDocument());
    fireEvent.click(screen.getByText('María'));
    expect(screen.getByText(/CREATE · certificate/i)).toBeInTheDocument();
    expect(screen.getByText(/"code": "C4572A"/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/audit/audit-page.test.tsx
```

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/audit/audit-page.tsx`:

```tsx
'use client';

import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import type { AuditEntry } from '@/lib/types/audit';
import { AuditFilters, type AuditFiltersValue } from './audit-filters';
import { AuditTable } from './audit-table';
import { AuditDetailModal } from './audit-detail-modal';

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

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/audit/audit-page.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/audit/audit-page.tsx components/audit/audit-page.test.tsx
git commit -m "$(cat <<'EOF'
feat(audit): AuditPage orchestrator

Owns filter + page + selectedEntry state. Computes default 30-day
range inside useMemo so it's deterministic per mount. Resets page=0
on filter change.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Wire `/audit` route + local smoke

**Files:**
- Modify: `app/(app)/audit/page.tsx`

- [ ] **Step 1: Replace the route file**

Overwrite `/Users/llam/dev/araguaney_front/app/(app)/audit/page.tsx` with:

```tsx
import { AuditPage } from '@/components/audit/audit-page';

export default function AuditRoute() {
  return <AuditPage />;
}
```

- [ ] **Step 2: Verify + build**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
pnpm build
```

Expected: build succeeds; `/audit` listed as `ƒ` (dynamic).

- [ ] **Step 3: Boot dev + auth-gate smoke**

```bash
cd /Users/llam/dev/araguaney_front
lsof -ti:3000 | xargs kill -9 2>/dev/null
pnpm dev > /tmp/front-task11.log 2>&1 &
PID=$!
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if grep -q "Ready in" /tmp/front-task11.log 2>/dev/null; then echo "ready in ${i}s"; break; fi
  sleep 1
done

curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3000/audit

kill $PID 2>/dev/null
wait $PID 2>/dev/null
```

Expected: `307` → `/login`.

- [ ] **Step 4: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add "app/(app)/audit/page.tsx"
git commit -m "$(cat <<'EOF'
feat(audit): wire /audit route

Replaces the Slice 1 ComingSoon stub. Server Component shell mounts
the client orchestrator. Auth gate verified locally (307 → /login).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Push + open PR

**Files:** none.

- [ ] **Step 1: Push**

```bash
cd /Users/llam/dev/araguaney_front
git push -u origin feat/slice-8-audit
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "feat: Slice 8 — /audit log viewer" --body "$(cat <<'EOF'
## Summary

Pantalla \`/audit\` con lista paginada de eventos \`cfb.audit_log\` + filtros + modal de detalle con payload JSON.

- Filtros: entity_type (8 pills + dropdown "Otros" para los 5 menos usados), action (5 pills + Todas), date range (default últimos 30 días)
- Click en row → modal con header (action+entity+fecha), bloque "Quién" (actor+IP+user-agent), bloque "Qué" (payload pretty-printed)
- Cross-link \`entity_id\` → \`/certificates/{id}\` solo cuando \`entity_type === 'certificate'\` (resto: mono text)
- Read-only, sin mutations. Permission \`audit.read\` la tienen los 3 roles.

## What's new

- \`lib/types/audit.ts\`
- \`lib/api/audit.ts\` + test
- \`lib/format/date.ts\` — agrega \`fmtDateTime\` helper
- 7 componentes nuevos en \`components/audit/\` (pill, link, row, filters, table, modal, page)
- \`app/(app)/audit/page.tsx\` — replace ComingSoon

## Test Plan

- [x] \`pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check && pnpm build\` — todo clean
- [x] ~31 nuevos tests pasando
- [ ] Vercel preview renders sin console errors
- [ ] Flow end-to-end: filtros funcionan, paginación funciona, click row abre modal con payload visible
- [ ] Las 3 roles ven la página (operator + admin + auditor)

## Notes

- No actor filter en v1 (requiere listUsers, deferred)
- No CSV export en v1
- Cross-link expandible cuando lleguen /batches/[id], /investors/[id], etc.

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

- New route `/audit` with list + filters + payload modal.
- 7 new components in `components/audit/` (+ tests).
- `listAudit` Server Action.
- New `AuditEntry` types.
- `fmtDateTime` helper.
- ~31 new tests.

**Test Plan**

- [x] `pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check && pnpm build` — todo clean
- [x] ~31 nuevos tests pasando

**Notes**

- No back changes — `GET /api/audit` already exists.
- No actor filter (deferred to follow-up; requires user-picker).
- Cross-link only for certificates (only entity with a detail page today).
- Pagination is server-side (back's standard `limit/offset`).

---

## Self-Review

**Spec coverage:**

- ✅ List page with paginación — Task 8 (AuditTable)
- ✅ Filters (entity_type + action + date range) — Task 7 (AuditFilters)
- ✅ Modal with payload pretty-printed — Task 9 (AuditDetailModal)
- ✅ Cross-link entity_id → /certificates/{id} only for certs — Task 5 (AuditEntityLink)
- ✅ Default 30-day range — Task 10 (AuditPage.defaultFilters)
- ✅ `audit.read` universal — no gating in any component (all rendered for any logged-in role)
- ✅ AuditActionPill mapping — Task 4
- ✅ fmtDateTime helper — Task 2
- ✅ Route wire-up — Task 11
- ✅ Push + PR — Task 12

**Placeholder scan:** No TODOs, no TBDs. All test code is concrete. All API/component code is shown in full.

**Type/value consistency:**
- `AuditEntry` type defined in Task 1 (`lib/types/audit.ts`) is consumed by `AuditRow` (Task 6), `AuditTable` (Task 8), `AuditDetailModal` (Task 9), `AuditPage` (Task 10), and the API response (Task 3).
- `AuditEntityType` consumed by `AuditEntityLink` (Task 5), `AuditFilters` (Task 7), and the API query (Task 3).
- `AuditFiltersValue` defined in Task 7 (`audit-filters.tsx`) is consumed by `AuditTable` (Task 8) and `AuditPage` (Task 10).
- `buildQuery` is internal to `AuditTable` (not exported) — orchestrator doesn't need it since there's no metrics strip sharing the cache key.
- `fmtDateTime` defined in Task 2 is consumed by `AuditRow` (Task 6) and `AuditDetailModal` (Task 9).

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-13-front-slice-8-audit.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Fresh subagent per task + two-stage review.

**2. Inline Execution** — Same session with batch checkpoints.

**Which approach?**
