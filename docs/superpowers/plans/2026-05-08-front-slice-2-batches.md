# araguaney_front Slice 2 — `/batches` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first business feature on `araguaney_front`: a `/batches` page with a list of historic batches and a modal to upload a new Excel file. Single-step upload (no preview-then-confirm). TanStack Query for fetching + cache invalidation. Pixel-perfect with the design mockup at `design/_extracted/c49dcc84-...js`.

**Architecture:** Server Component shell mounts a Client orchestrator. `<BatchesPage>` composes `<PageHeader>` + `<UploadButton>` + `<BatchesTable>` + `<UploadBatchModal>`. Modal stage derives from `mutation.status` of TanStack `useMutation`. List uses `useQuery(['batches'])`; mutation invalidates on success. User role + permission gating via `<UserProvider>` context + `hasPermission()` helper.

**Tech Stack:** Next.js 16 App Router, TanStack Query (in real use here), shadcn/ui base-nova primitives, sonner for toasts, Vitest + Testing Library, hand-typed response shapes (back openapi gap).

**Spec:** `docs/superpowers/specs/2026-05-08-front-slice-2-batches-design.md`

**Working directory note:** all code lives in `/Users/llam/dev/araguaney_front/`. The plan and spec live in `/Users/llam/dev/araguaney_back/docs/`. Implementer must `cd /Users/llam/dev/araguaney_front` for any task command.

**Pre-req branch:** Work on `feat/slice-2-batches` (controller creates this before Task 1; tasks just commit to it).

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `package.json` | modify | Install `sonner` |
| `app/layout.tsx` | modify | Mount `<Toaster />` from sonner |
| `lib/format/money.ts` | create | `fmtMoney(n, decimals?)`, `fmtMoney2(n)` |
| `lib/format/money.test.ts` | create | Tests |
| `lib/format/date.ts` | create | `fmtDate(iso)` → `DD/MM/YYYY` |
| `lib/format/date.test.ts` | create | Tests |
| `lib/permissions/has-permission.ts` | create | Role × permission map + `hasPermission()` |
| `lib/permissions/has-permission.test.ts` | create | Tests |
| `lib/auth/user-context.tsx` | create | `<UserProvider>` + `useUser()` |
| `lib/auth/user-context.test.tsx` | create | Tests |
| `components/layout/app-shell.tsx` | modify | Wrap children in `<UserProvider value={user}>` |
| `lib/types/batch.ts` | create | `BatchStatus`, `BatchSummary`, `BatchListResponse`, `UploadBatchInput` |
| `lib/api/client.ts` | modify | Skip `content-type` when body is `FormData` |
| `lib/api/client.test.ts` | modify | Add FormData test |
| `lib/api/batches.ts` | create | `listBatches(query)`, `uploadBatch(input)` |
| `lib/api/batches.test.ts` | create | Tests |
| `test/helpers/tanstack.tsx` | create | `renderWithQuery()` helper |
| `components/ui/pill.tsx` | create | Reusable primitive (variants success/warn/info/neutral/sweep) |
| `components/ui/pill.test.tsx` | create | Tests per variant |
| `components/batches/batch-status-pill.tsx` | create | Status → variant + label español |
| `components/batches/batch-status-pill.test.tsx` | create | Tests per status |
| `components/batches/batch-row.tsx` | create | Render single row in table |
| `components/batches/batch-row.test.tsx` | create | Tests |
| `components/batches/upload-button.tsx` | create | Permission-gated button via `useUser` |
| `components/batches/upload-button.test.tsx` | create | Tests per role |
| `components/batches/batches-table.tsx` | create | `useQuery` + table + skeleton/error/empty |
| `components/batches/batches-table.test.tsx` | create | Tests with mocks |
| `components/batches/upload-batch-uploading.tsx` | create | Spinner stage |
| `components/batches/upload-batch-uploading.test.tsx` | create | Tests |
| `components/batches/upload-batch-recent.tsx` | create | "Lotes recientes" widget in dropzone |
| `components/batches/upload-batch-recent.test.tsx` | create | Tests |
| `components/batches/upload-batch-dropzone.tsx` | create | Drop zone + recent + error inline |
| `components/batches/upload-batch-dropzone.test.tsx` | create | Tests |
| `components/batches/upload-batch-modal.tsx` | create | Modal envoltorio, mutation, stages |
| `components/batches/upload-batch-modal.test.tsx` | create | Tests del flow completo |
| `components/batches/batches-page.tsx` | create | Orquestador (PageHeader + table + modal) |
| `app/(app)/batches/page.tsx` | modify | Replace stub with `<BatchesPage />` |

**Total:** ~28 files (16 source + 12 tests).

**Manual operational tasks:**

| Action | Owner | When |
|---|---|---|
| Push branch + open PR | controller | Task 20 |
| Review + merge | user | After Task 20 |
| Verify Vercel deploy + visual smoke | user | Post-merge |

---

## Task 1: Install sonner + add Toaster to root layout

**Why:** Toast notifications on successful upload. Sonner is shadcn's recommended toast library; not pre-installed by base-nova.

**Files:**
- Modify: `package.json` (deps)
- Modify: `app/layout.tsx`

- [ ] **Step 1: Install sonner**

```bash
cd /Users/llam/dev/araguaney_front
pnpm add sonner
```

- [ ] **Step 2: Add `<Toaster />` to root layout**

Read current `/Users/llam/dev/araguaney_front/app/layout.tsx`. Add `import { Toaster } from 'sonner';` and place `<Toaster />` inside the body, AFTER the `<QueryProvider>` children. The full file should look like:

```tsx
import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { QueryProvider } from '@/components/providers/query-provider';
import { Toaster } from 'sonner';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Cashea CFB',
  description: 'Sistema interno de Cashea para emisión de Certificados de Financiamiento Bursátil',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <QueryProvider>{children}</QueryProvider>
        <Toaster position="bottom-right" richColors />
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Verify build**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check && pnpm build
```

Expected: all clean.

- [ ] **Step 4: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add package.json pnpm-lock.yaml app/layout.tsx
git commit -m "$(cat <<'EOF'
chore: install sonner + mount Toaster in root layout

Toast notifications used by Slice 2's upload flow (success + error).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `lib/format/money.ts`

**Why:** Reusable money formatter matching the design's `fmtMoney` (from `cac2320f-...js`).

**Files:**
- Create: `lib/format/money.ts`
- Create: `lib/format/money.test.ts`

- [ ] **Step 1: Write failing test**

```bash
cd /Users/llam/dev/araguaney_front
mkdir -p lib/format
```

Create `/Users/llam/dev/araguaney_front/lib/format/money.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fmtMoney, fmtMoney2 } from './money';

describe('fmtMoney', () => {
  it('formats integers with thousand separators and no decimals', () => {
    expect(fmtMoney(1132418)).toBe('$1,132,418');
    expect(fmtMoney(0)).toBe('$0');
    expect(fmtMoney(999)).toBe('$999');
  });

  it('formats non-integers with two decimals by default', () => {
    expect(fmtMoney(1247.5)).toBe('$1,247.50');
    expect(fmtMoney(0.1)).toBe('$0.10');
  });

  it('respects explicit decimals override', () => {
    expect(fmtMoney(1132418, 2)).toBe('$1,132,418.00');
    expect(fmtMoney(1247.567, 0)).toBe('$1,248');
  });

  it('handles negatives', () => {
    expect(fmtMoney(-500)).toBe('-$500');
    expect(fmtMoney(-1247.5)).toBe('-$1,247.50');
  });
});

describe('fmtMoney2', () => {
  it('always uses two decimals', () => {
    expect(fmtMoney2(1132418)).toBe('$1,132,418.00');
    expect(fmtMoney2(1247.5)).toBe('$1,247.50');
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/format/money.test.ts
```

Expected: FAIL — `./money` doesn't exist.

- [ ] **Step 3: Implement `lib/format/money.ts`**

Create `/Users/llam/dev/araguaney_front/lib/format/money.ts`:

```ts
export function fmtMoney(n: number, decimals: number | null = null): string {
  const d = decimals === null ? (Number.isInteger(n) ? 0 : 2) : decimals;
  const abs = Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
  return n < 0 ? `-$${abs}` : `$${abs}`;
}

export function fmtMoney2(n: number): string {
  return fmtMoney(n, 2);
}
```

- [ ] **Step 4: Confirm tests pass**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/format/money.test.ts
```

Expected: 6 tests green.

- [ ] **Step 5: Verify suite + format**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

Expected: all clean. Run `pnpm format` if needed.

- [ ] **Step 6: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add lib/format/money.ts lib/format/money.test.ts
git commit -m "$(cat <<'EOF'
feat(format): fmtMoney + fmtMoney2 helpers

Match the design's formatter: $-prefix, US-locale thousand separators,
0 decimals for integers / 2 for non-integers (override available).
Handles negatives with leading minus.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `lib/format/date.ts`

**Why:** ISO timestamp → `DD/MM/YYYY` format used by the design.

**Files:**
- Create: `lib/format/date.ts`
- Create: `lib/format/date.test.ts`

- [ ] **Step 1: Write failing test**

Create `/Users/llam/dev/araguaney_front/lib/format/date.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fmtDate } from './date';

describe('fmtDate', () => {
  it('formats ISO timestamps as DD/MM/YYYY', () => {
    expect(fmtDate('2026-04-20T14:30:00.000Z')).toBe('20/04/2026');
    expect(fmtDate('2026-01-01T00:00:00.000Z')).toBe('01/01/2026');
    expect(fmtDate('2026-12-31T23:59:59.000Z')).toBe('31/12/2026');
  });

  it('returns "—" for null', () => {
    expect(fmtDate(null)).toBe('—');
  });

  it('returns "—" for undefined', () => {
    expect(fmtDate(undefined)).toBe('—');
  });

  it('returns "—" for empty string', () => {
    expect(fmtDate('')).toBe('—');
  });

  it('returns "—" for invalid date strings', () => {
    expect(fmtDate('not-a-date')).toBe('—');
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/format/date.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `lib/format/date.ts`**

Create `/Users/llam/dev/araguaney_front/lib/format/date.ts`:

```ts
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}
```

UTC is intentional — the back stores UTC; we display the calendar date as-stored without timezone shifting (matches the design's `20/04/2026` for `2026-04-20T...Z`).

- [ ] **Step 4: Confirm tests pass**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/format/date.test.ts
```

Expected: 5 tests green.

- [ ] **Step 5: Suite + format check**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 6: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add lib/format/date.ts lib/format/date.test.ts
git commit -m "$(cat <<'EOF'
feat(format): fmtDate helper (ISO → DD/MM/YYYY)

UTC-based; null/undefined/invalid → "—".

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `lib/permissions/has-permission.ts`

**Why:** Role-based UI gating. Hardcoded map for Slice 2; replaced when back exposes effective permissions in `/api/me`.

**Files:**
- Create: `lib/permissions/has-permission.ts`
- Create: `lib/permissions/has-permission.test.ts`

- [ ] **Step 1: Write failing test**

```bash
cd /Users/llam/dev/araguaney_front
mkdir -p lib/permissions
```

Create `/Users/llam/dev/araguaney_front/lib/permissions/has-permission.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { hasPermission } from './has-permission';

describe('hasPermission', () => {
  it('operator can upload batches', () => {
    expect(hasPermission('operator', 'batch.upload')).toBe(true);
  });

  it('admin can upload batches', () => {
    expect(hasPermission('admin', 'batch.upload')).toBe(true);
  });

  it('auditor cannot upload batches', () => {
    expect(hasPermission('auditor', 'batch.upload')).toBe(false);
  });

  it('all roles can read batches', () => {
    expect(hasPermission('operator', 'batch.read')).toBe(true);
    expect(hasPermission('admin', 'batch.read')).toBe(true);
    expect(hasPermission('auditor', 'batch.read')).toBe(true);
  });

  it('returns false for unknown permissions', () => {
    expect(hasPermission('admin', 'nonexistent.perm')).toBe(false);
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/permissions/has-permission.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `lib/permissions/has-permission.ts`**

Create `/Users/llam/dev/araguaney_front/lib/permissions/has-permission.ts`:

```ts
import type { MeUser } from '@/lib/api/me';

type Role = MeUser['role'];

const OPERATOR_PERMS = [
  'batch.read',
  'batch.upload',
  'order.read',
  'merchant.read',
  'investor.read',
  'investor.write',
  'certificate.read',
  'certificate.create',
  'certificate.cancel',
  'audit.read',
] as const;

const AUDITOR_PERMS = [
  'batch.read',
  'order.read',
  'merchant.read',
  'investor.read',
  'certificate.read',
  'audit.read',
] as const;

const ADMIN_PERMS = [
  ...OPERATOR_PERMS,
  'permission.manage',
  'setting.write',
  'user.manage',
] as const;

const ROLE_PERMISSIONS: Record<Role, ReadonlySet<string>> = {
  operator: new Set(OPERATOR_PERMS),
  auditor: new Set(AUDITOR_PERMS),
  admin: new Set(ADMIN_PERMS),
};

export function hasPermission(role: Role, permission: string): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}
```

- [ ] **Step 4: Confirm tests pass**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/permissions/has-permission.test.ts
```

Expected: 5 tests green.

- [ ] **Step 5: Suite + format check**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 6: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add lib/permissions/
git commit -m "$(cat <<'EOF'
feat(permissions): hasPermission helper with role × permission map

Hardcoded mirror of cfb.role_permissions. Used for UI gating.
Replaced in Slice 5+ when back exposes effective permissions in
/api/me directly.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `<UserProvider>` + `useUser()` hook

**Why:** Lets Client Components read the authenticated user without prop-drilling. Used by `<UploadButton>` (and future client components).

**Files:**
- Create: `lib/auth/user-context.tsx`
- Create: `lib/auth/user-context.test.tsx`
- Modify: `components/layout/app-shell.tsx` (wrap children)

- [ ] **Step 1: Write failing test**

Create `/Users/llam/dev/araguaney_front/lib/auth/user-context.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UserProvider, useUser } from './user-context';
import type { MeUser } from '@/lib/api/me';

const user: MeUser = {
  id: 'u-1',
  email: 'a@b.com',
  full_name: 'Test User',
  role: 'admin',
  is_active: true,
};

function Probe() {
  const u = useUser();
  return <div data-testid="probe">{u.full_name}</div>;
}

describe('UserProvider / useUser', () => {
  it('exposes the user from provider', () => {
    render(
      <UserProvider user={user}>
        <Probe />
      </UserProvider>,
    );
    expect(screen.getByTestId('probe').textContent).toBe('Test User');
  });

  it('throws when useUser is called outside the provider', () => {
    // Suppress React error boundary noise during the throw assertion
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/UserProvider/);
    spy.mockRestore();
  });
});
```

Add `vi` to imports at the top:

```tsx
import { describe, it, expect, vi } from 'vitest';
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/auth/user-context.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement `lib/auth/user-context.tsx`**

Create `/Users/llam/dev/araguaney_front/lib/auth/user-context.tsx`:

```tsx
'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { MeUser } from '@/lib/api/me';

const UserContext = createContext<MeUser | null>(null);

export function UserProvider({ user, children }: { user: MeUser; children: ReactNode }) {
  return <UserContext.Provider value={user}>{children}</UserContext.Provider>;
}

export function useUser(): MeUser {
  const u = useContext(UserContext);
  if (!u) throw new Error('useUser must be called inside <UserProvider>');
  return u;
}
```

- [ ] **Step 4: Confirm tests pass**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/auth/user-context.test.tsx
```

Expected: 2 tests green.

- [ ] **Step 5: Wrap `<AppShell>` children with `<UserProvider>`**

Read `/Users/llam/dev/araguaney_front/components/layout/app-shell.tsx`. Modify to wrap children in `<UserProvider value={user}>`.

The new content should be:

```tsx
import type { MeUser } from '@/lib/api/me';
import { UserProvider } from '@/lib/auth/user-context';
import { Sidebar } from './sidebar';

interface Props {
  user: MeUser;
  children: React.ReactNode;
}

export function AppShell({ user, children }: Props) {
  return (
    <div className="grid min-h-screen grid-cols-[220px_1fr]">
      <Sidebar user={user} />
      <main className="flex min-w-0 flex-col">
        <UserProvider user={user}>{children}</UserProvider>
      </main>
    </div>
  );
}
```

- [ ] **Step 6: Verify suite (existing AppShell test still passes)**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

Expected: all pass. The existing `app-shell.test.tsx` should still work because `<UserProvider>` just wraps children — children that don't call `useUser()` are unaffected.

- [ ] **Step 7: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add lib/auth/user-context.tsx lib/auth/user-context.test.tsx components/layout/app-shell.tsx
git commit -m "$(cat <<'EOF'
feat(auth): UserProvider + useUser() hook

Lets Client Components read the authenticated MeUser without
prop-drilling. AppShell wraps its main content in <UserProvider>.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `lib/types/batch.ts` + `lib/api/client.ts` FormData fix

**Why:** Hand-typed batch shapes (back openapi gap) + correct multipart upload.

**Files:**
- Create: `lib/types/batch.ts`
- Modify: `lib/api/client.ts`
- Modify: `lib/api/client.test.ts`

- [ ] **Step 1: Create `lib/types/batch.ts`**

```bash
cd /Users/llam/dev/araguaney_front
mkdir -p lib/types
```

Create `/Users/llam/dev/araguaney_front/lib/types/batch.ts`:

```ts
export type BatchStatus = 'uploaded' | 'parsing' | 'imported' | 'rejected' | 'archived';

export interface BatchSummary {
  id: string;
  external_code: string;
  status: BatchStatus;
  rows_imported: number;
  rows_rejected: number;
  total_orders_amount: string;
  total_installments_amount: string;
  imported_at: string | null;
  rejection_reason: string | null;
  uploaded_at: string | null;
  uploaded_by: { id: string; email: string; full_name: string } | null;
}

export interface BatchListResponse {
  data: BatchSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface UploadBatchInput {
  file: File;
  externalCode?: string;
}
```

- [ ] **Step 2: Add failing test for FormData skip**

Open `/Users/llam/dev/araguaney_front/lib/api/client.test.ts`. Add this test inside the existing `describe('apiFetch', ...)`:

```ts
it('does not set content-type when body is FormData', async () => {
  mockReadCookie.mockResolvedValueOnce('jwt');
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

  const fd = new FormData();
  fd.set('file', new Blob(['x'], { type: 'application/octet-stream' }), 'test.bin');

  await apiFetch('/api/batches', { method: 'POST', body: fd });

  const init = fetchMock.mock.calls[0][1] as RequestInit;
  expect((init.headers as Headers).get('content-type')).toBeNull();
});
```

- [ ] **Step 3: Run, confirm the new test fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/api/client.test.ts
```

Expected: the new test fails (current code sets `content-type: application/json` for any body).

- [ ] **Step 4: Modify `lib/api/client.ts`**

Open `/Users/llam/dev/araguaney_front/lib/api/client.ts`. Find the line(s):

```ts
if (!headers.has('content-type') && init?.body) {
  headers.set('content-type', 'application/json');
}
```

Replace with:

```ts
if (
  !headers.has('content-type') &&
  init?.body &&
  !(init.body instanceof FormData)
) {
  headers.set('content-type', 'application/json');
}
```

- [ ] **Step 5: Confirm test passes**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/api/client.test.ts
```

Expected: all 6 tests green (5 existing + 1 new).

- [ ] **Step 6: Suite + format check**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 7: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add lib/types/batch.ts lib/api/client.ts lib/api/client.test.ts
git commit -m "$(cat <<'EOF'
feat(api): batch types + FormData support in apiFetch

- lib/types/batch.ts: hand-typed BatchSummary etc. (back openapi gap)
- apiFetch skips content-type when body is FormData so the browser
  can set multipart/form-data with the boundary

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `lib/api/batches.ts`

**Why:** The two API functions consumed by TanStack Query hooks.

**Files:**
- Create: `lib/api/batches.ts`
- Create: `lib/api/batches.test.ts`

- [ ] **Step 1: Write failing test**

Create `/Users/llam/dev/araguaney_front/lib/api/batches.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listBatches, uploadBatch } from './batches';

const mockApiFetch = vi.fn();
vi.mock('./client', () => ({
  apiFetch: (path: string, init?: RequestInit) => mockApiFetch(path, init),
  ApiError: class ApiError extends Error {},
}));

describe('listBatches', () => {
  beforeEach(() => vi.clearAllMocks());

  it('GETs /api/batches with no params when query is empty', async () => {
    mockApiFetch.mockResolvedValueOnce({ data: [], total: 0, limit: 50, offset: 0 });
    await listBatches();
    expect(mockApiFetch).toHaveBeenCalledWith('/api/batches', { method: 'GET' });
  });

  it('appends query params when provided', async () => {
    mockApiFetch.mockResolvedValueOnce({ data: [], total: 0, limit: 50, offset: 0 });
    await listBatches({ limit: 50, offset: 0, status: 'imported' });
    expect(mockApiFetch).toHaveBeenCalledWith(
      '/api/batches?limit=50&offset=0&status=imported',
      { method: 'GET' },
    );
  });

  it('returns the parsed response', async () => {
    const expected = { data: [{ id: '1' }], total: 1, limit: 50, offset: 0 };
    mockApiFetch.mockResolvedValueOnce(expected);
    const result = await listBatches();
    expect(result).toEqual(expected);
  });
});

describe('uploadBatch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POSTs FormData with the file to /api/batches', async () => {
    mockApiFetch.mockResolvedValueOnce({ id: 'b-1' });
    const file = new File(['content'], 'test.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    await uploadBatch({ file });

    const [path, init] = mockApiFetch.mock.calls[0];
    expect(path).toBe('/api/batches');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('file')).toBe(file);
    expect((init.body as FormData).get('external_code')).toBeNull();
  });

  it('includes external_code when provided', async () => {
    mockApiFetch.mockResolvedValueOnce({ id: 'b-1' });
    const file = new File(['x'], 'a.xlsx');
    await uploadBatch({ file, externalCode: 'BATCH-001' });

    const init = mockApiFetch.mock.calls[0][1] as RequestInit;
    expect((init.body as FormData).get('external_code')).toBe('BATCH-001');
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/api/batches.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `lib/api/batches.ts`**

Create `/Users/llam/dev/araguaney_front/lib/api/batches.ts`:

```ts
import { apiFetch } from './client';
import type {
  BatchListResponse,
  BatchStatus,
  BatchSummary,
  UploadBatchInput,
} from '@/lib/types/batch';

interface ListBatchesQuery {
  limit?: number;
  offset?: number;
  status?: BatchStatus;
}

export async function listBatches(query: ListBatchesQuery = {}): Promise<BatchListResponse> {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.offset !== undefined) params.set('offset', String(query.offset));
  if (query.status) params.set('status', query.status);
  const qs = params.toString();
  return apiFetch<BatchListResponse>(`/api/batches${qs ? '?' + qs : ''}`, { method: 'GET' });
}

export async function uploadBatch(input: UploadBatchInput): Promise<BatchSummary> {
  const fd = new FormData();
  fd.set('file', input.file);
  if (input.externalCode) fd.set('external_code', input.externalCode);
  return apiFetch<BatchSummary>('/api/batches', { method: 'POST', body: fd });
}
```

- [ ] **Step 4: Confirm tests pass**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/api/batches.test.ts
```

Expected: 5 tests green.

- [ ] **Step 5: Suite + format check**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 6: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add lib/api/batches.ts lib/api/batches.test.ts
git commit -m "$(cat <<'EOF'
feat(api): listBatches + uploadBatch

Two functions consumed by TanStack Query hooks. listBatches builds
query string from optional filters; uploadBatch builds multipart
FormData with optional external_code.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `test/helpers/tanstack.tsx`

**Why:** Tests of components that use `useQuery`/`useMutation` need a fresh `QueryClient` per render.

**Files:**
- Create: `test/helpers/tanstack.tsx`

- [ ] **Step 1: Create the helper**

```bash
cd /Users/llam/dev/araguaney_front
mkdir -p test/helpers
```

Create `/Users/llam/dev/araguaney_front/test/helpers/tanstack.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';

export function renderWithQuery(ui: ReactElement, options?: RenderOptions): RenderResult {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>, options);
}
```

`retry: false` is critical for tests — otherwise a single failed mutation causes vitest to wait for the default 3 retries.

- [ ] **Step 2: Verify it's importable (no test needed; it's a test helper)**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm format:check
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add test/helpers/tanstack.tsx
git commit -m "$(cat <<'EOF'
chore(test): renderWithQuery helper for TanStack-aware components

Fresh QueryClient per render with retry disabled (so failed
queries/mutations report immediately instead of stalling vitest
for the default retry backoff).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `<Pill>` primitive

**Why:** Reusable status pill used by `<BatchStatusPill>` (and slices 3+ for certificates, investors, etc.).

**Files:**
- Create: `components/ui/pill.tsx`
- Create: `components/ui/pill.test.tsx`

- [ ] **Step 1: Write failing test**

Create `/Users/llam/dev/araguaney_front/components/ui/pill.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Pill } from './pill';

describe('<Pill />', () => {
  it('renders children', () => {
    render(<Pill variant="success">Activo</Pill>);
    expect(screen.getByText('Activo')).toBeInTheDocument();
  });

  it('applies success variant classes', () => {
    const { container } = render(<Pill variant="success">x</Pill>);
    const span = container.querySelector('span.bg-green-bg');
    expect(span).not.toBeNull();
  });

  it('applies warn variant classes', () => {
    const { container } = render(<Pill variant="warn">x</Pill>);
    expect(container.querySelector('span.bg-warn-bg')).not.toBeNull();
  });

  it('applies info variant classes', () => {
    const { container } = render(<Pill variant="info">x</Pill>);
    expect(container.querySelector('span.bg-info-bg')).not.toBeNull();
  });

  it('applies neutral variant classes', () => {
    const { container } = render(<Pill variant="neutral">x</Pill>);
    expect(container.querySelector('span.bg-neutral-bg')).not.toBeNull();
  });

  it('applies sweep variant classes', () => {
    const { container } = render(<Pill variant="sweep">x</Pill>);
    expect(container.querySelector('span.bg-sweep-bg')).not.toBeNull();
  });

  it('defaults to neutral when no variant is provided', () => {
    const { container } = render(<Pill>x</Pill>);
    expect(container.querySelector('span.bg-neutral-bg')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/ui/pill.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement `<Pill>`**

Create `/Users/llam/dev/araguaney_front/components/ui/pill.tsx`:

```tsx
import { cn } from '@/lib/utils';

export type PillVariant = 'success' | 'warn' | 'info' | 'neutral' | 'sweep';

interface Props {
  variant?: PillVariant;
  children: React.ReactNode;
  className?: string;
}

const VARIANT_CLASSES: Record<PillVariant, string> = {
  success: 'bg-green-bg text-green-text',
  warn: 'bg-warn-bg text-warn-text',
  info: 'bg-info-bg text-info-text',
  neutral: 'bg-neutral-bg text-neutral-text',
  sweep: 'bg-sweep-bg text-sweep-text border border-dashed border-sweep-border',
};

const DOT_CLASSES: Record<PillVariant, string> = {
  success: 'bg-green-dot',
  warn: 'bg-warn-dot',
  info: 'bg-info-text',
  neutral: 'bg-text-3',
  sweep: 'bg-sweep-dot',
};

export function Pill({ variant = 'neutral', children, className }: Props) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[11px] font-medium leading-[1.4]',
        VARIANT_CLASSES[variant],
        className,
      )}
    >
      <span className={cn('h-[5px] w-[5px] rounded-full', DOT_CLASSES[variant])} />
      {children}
    </span>
  );
}
```

- [ ] **Step 4: Confirm tests pass**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/ui/pill.test.tsx
```

Expected: 7 tests green.

- [ ] **Step 5: Suite + format check**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 6: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/ui/pill.tsx components/ui/pill.test.tsx
git commit -m "$(cat <<'EOF'
feat(ui): Pill primitive (success/warn/info/neutral/sweep variants)

Tokens map to design system colors set up in Slice 1's @theme.
Used by BatchStatusPill in Slice 2 and certificate/investor/etc.
status pills in subsequent slices.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: `<BatchStatusPill>`

**Why:** Maps `BatchStatus` enum → pill variant + Spanish label.

**Files:**
- Create: `components/batches/batch-status-pill.tsx`
- Create: `components/batches/batch-status-pill.test.tsx`

- [ ] **Step 1: Write failing test**

```bash
cd /Users/llam/dev/araguaney_front
mkdir -p components/batches
```

Create `/Users/llam/dev/araguaney_front/components/batches/batch-status-pill.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BatchStatusPill } from './batch-status-pill';

describe('<BatchStatusPill />', () => {
  it('renders "Activo" with success variant for imported', () => {
    const { container } = render(<BatchStatusPill status="imported" />);
    expect(screen.getByText('Activo')).toBeInTheDocument();
    expect(container.querySelector('span.bg-green-bg')).not.toBeNull();
  });

  it('renders "Subido" with info variant for uploaded', () => {
    const { container } = render(<BatchStatusPill status="uploaded" />);
    expect(screen.getByText('Subido')).toBeInTheDocument();
    expect(container.querySelector('span.bg-info-bg')).not.toBeNull();
  });

  it('renders "Procesando" with info variant for parsing', () => {
    const { container } = render(<BatchStatusPill status="parsing" />);
    expect(screen.getByText('Procesando')).toBeInTheDocument();
    expect(container.querySelector('span.bg-info-bg')).not.toBeNull();
  });

  it('renders "Rechazado" with warn variant for rejected', () => {
    const { container } = render(<BatchStatusPill status="rejected" />);
    expect(screen.getByText('Rechazado')).toBeInTheDocument();
    expect(container.querySelector('span.bg-warn-bg')).not.toBeNull();
  });

  it('renders "Archivado" with neutral variant for archived', () => {
    const { container } = render(<BatchStatusPill status="archived" />);
    expect(screen.getByText('Archivado')).toBeInTheDocument();
    expect(container.querySelector('span.bg-neutral-bg')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/batches/batch-status-pill.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement `<BatchStatusPill>`**

Create `/Users/llam/dev/araguaney_front/components/batches/batch-status-pill.tsx`:

```tsx
import { Pill, type PillVariant } from '@/components/ui/pill';
import type { BatchStatus } from '@/lib/types/batch';

const MAP: Record<BatchStatus, { variant: PillVariant; label: string }> = {
  imported: { variant: 'success', label: 'Activo' },
  uploaded: { variant: 'info', label: 'Subido' },
  parsing: { variant: 'info', label: 'Procesando' },
  rejected: { variant: 'warn', label: 'Rechazado' },
  archived: { variant: 'neutral', label: 'Archivado' },
};

export function BatchStatusPill({ status }: { status: BatchStatus }) {
  const m = MAP[status];
  return <Pill variant={m.variant}>{m.label}</Pill>;
}
```

- [ ] **Step 4: Confirm tests pass**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/batches/batch-status-pill.test.tsx
```

Expected: 5 tests green.

- [ ] **Step 5: Suite + format check**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 6: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/batches/batch-status-pill.tsx components/batches/batch-status-pill.test.tsx
git commit -m "$(cat <<'EOF'
feat(batches): BatchStatusPill (status → variant + Spanish label)

Maps the 5 BatchStatus enum values to the Pill variants from Slice 2's
ui/pill.tsx with Spanish labels.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: `<BatchRow>`

**Why:** Renders one row of the batches table.

**Files:**
- Create: `components/batches/batch-row.tsx`
- Create: `components/batches/batch-row.test.tsx`

- [ ] **Step 1: Write failing test**

Create `/Users/llam/dev/araguaney_front/components/batches/batch-row.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BatchRow } from './batch-row';
import type { BatchSummary } from '@/lib/types/batch';

const sampleBatch: BatchSummary = {
  id: 'b-1',
  external_code: '00086',
  status: 'imported',
  rows_imported: 45389,
  rows_rejected: 0,
  total_orders_amount: '1132418.0000',
  total_installments_amount: '1132418.0000',
  imported_at: '2026-04-20T14:30:00.000Z',
  rejection_reason: null,
  uploaded_at: '2026-04-20T14:00:00.000Z',
  uploaded_by: { id: 'u-1', email: 'maria@cashea.app', full_name: 'María Rodríguez' },
};

function renderInTable(row: React.ReactElement) {
  return render(
    <table>
      <tbody>{row}</tbody>
    </table>,
  );
}

describe('<BatchRow />', () => {
  it('renders external_code', () => {
    renderInTable(<BatchRow batch={sampleBatch} />);
    expect(screen.getByText('00086')).toBeInTheDocument();
  });

  it('renders the formatted upload date', () => {
    renderInTable(<BatchRow batch={sampleBatch} />);
    expect(screen.getByText('20/04/2026')).toBeInTheDocument();
  });

  it('renders the uploader full_name', () => {
    renderInTable(<BatchRow batch={sampleBatch} />);
    expect(screen.getByText('María Rodríguez')).toBeInTheDocument();
  });

  it('renders rows_imported with thousand separators', () => {
    renderInTable(<BatchRow batch={sampleBatch} />);
    expect(screen.getByText('45,389')).toBeInTheDocument();
  });

  it('renders total_orders_amount as money', () => {
    renderInTable(<BatchRow batch={sampleBatch} />);
    expect(screen.getByText('$1,132,418')).toBeInTheDocument();
  });

  it('renders the status pill', () => {
    renderInTable(<BatchRow batch={sampleBatch} />);
    expect(screen.getByText('Activo')).toBeInTheDocument();
  });

  it('renders "—" when uploaded_by is null', () => {
    const noUser = { ...sampleBatch, uploaded_by: null };
    renderInTable(<BatchRow batch={noUser} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders "—" when uploaded_at is null', () => {
    const noDate = { ...sampleBatch, uploaded_at: null, uploaded_by: null };
    renderInTable(<BatchRow batch={noDate} />);
    // Both "—" appear (date + uploader)
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/batches/batch-row.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement `<BatchRow>`**

Create `/Users/llam/dev/araguaney_front/components/batches/batch-row.tsx`:

```tsx
import { fmtDate } from '@/lib/format/date';
import { fmtMoney } from '@/lib/format/money';
import type { BatchSummary } from '@/lib/types/batch';
import { BatchStatusPill } from './batch-status-pill';

export function BatchRow({ batch }: { batch: BatchSummary }) {
  return (
    <tr className="border-border-soft hover:bg-subtle border-b transition-colors">
      <td className="text-text-2 px-4 py-3.5 font-mono text-[11.5px]">{batch.external_code}</td>
      <td className="num px-4 py-3.5">{fmtDate(batch.uploaded_at)}</td>
      <td className="px-4 py-3.5">{batch.uploaded_by?.full_name ?? '—'}</td>
      <td className="num px-4 py-3.5 text-right font-medium">
        {batch.rows_imported.toLocaleString('en-US')}
      </td>
      <td className="num px-4 py-3.5 text-right font-medium">
        {fmtMoney(Number(batch.total_orders_amount))}
      </td>
      <td className="px-4 py-3.5">
        <BatchStatusPill status={batch.status} />
      </td>
    </tr>
  );
}
```

- [ ] **Step 4: Confirm tests pass**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/batches/batch-row.test.tsx
```

Expected: 8 tests green.

- [ ] **Step 5: Suite + format check**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 6: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/batches/batch-row.tsx components/batches/batch-row.test.tsx
git commit -m "$(cat <<'EOF'
feat(batches): BatchRow (table row with code/date/uploader/orders/capital/status)

Mono code, tabular nums, money formatter for capital, "—" fallbacks
for null uploader/date.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: `<UploadButton>`

**Why:** Permission-gated button that opens the upload modal.

**Files:**
- Create: `components/batches/upload-button.tsx`
- Create: `components/batches/upload-button.test.tsx`

- [ ] **Step 1: Write failing test**

Create `/Users/llam/dev/araguaney_front/components/batches/upload-button.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UploadButton } from './upload-button';
import { UserProvider } from '@/lib/auth/user-context';
import type { MeUser } from '@/lib/api/me';

const mkUser = (role: MeUser['role']): MeUser => ({
  id: 'u-1',
  email: 'a@b.com',
  full_name: 'Test',
  role,
  is_active: true,
});

describe('<UploadButton />', () => {
  it('renders for operator role', () => {
    render(
      <UserProvider user={mkUser('operator')}>
        <UploadButton onClick={vi.fn()} />
      </UserProvider>,
    );
    expect(screen.getByRole('button', { name: 'Subir lote' })).toBeInTheDocument();
  });

  it('renders for admin role', () => {
    render(
      <UserProvider user={mkUser('admin')}>
        <UploadButton onClick={vi.fn()} />
      </UserProvider>,
    );
    expect(screen.getByRole('button', { name: 'Subir lote' })).toBeInTheDocument();
  });

  it('does not render for auditor role', () => {
    const { container } = render(
      <UserProvider user={mkUser('auditor')}>
        <UploadButton onClick={vi.fn()} />
      </UserProvider>,
    );
    expect(container.querySelector('button')).toBeNull();
  });

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <UserProvider user={mkUser('operator')}>
        <UploadButton onClick={onClick} />
      </UserProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Subir lote' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/batches/upload-button.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement `<UploadButton>`**

Create `/Users/llam/dev/araguaney_front/components/batches/upload-button.tsx`:

```tsx
'use client';

import { useUser } from '@/lib/auth/user-context';
import { hasPermission } from '@/lib/permissions/has-permission';
import { Button } from '@/components/ui/button';

export function UploadButton({ onClick }: { onClick: () => void }) {
  const user = useUser();
  if (!hasPermission(user.role, 'batch.upload')) return null;
  return <Button onClick={onClick}>Subir lote</Button>;
}
```

- [ ] **Step 4: Confirm tests pass**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/batches/upload-button.test.tsx
```

Expected: 4 tests green.

- [ ] **Step 5: Suite + format check**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 6: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/batches/upload-button.tsx components/batches/upload-button.test.tsx
git commit -m "$(cat <<'EOF'
feat(batches): UploadButton (permission-gated via useUser)

Hidden for auditor role (no batch.upload permission).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: `<BatchesTable>`

**Why:** The fetched + rendered list. The first real consumer of TanStack Query.

**Files:**
- Create: `components/batches/batches-table.tsx`
- Create: `components/batches/batches-table.test.tsx`

- [ ] **Step 1: Write failing test**

Create `/Users/llam/dev/araguaney_front/components/batches/batches-table.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithQuery } from '@/test/helpers/tanstack';
import { BatchesTable } from './batches-table';
import type { BatchListResponse } from '@/lib/types/batch';

const mockListBatches = vi.fn();
vi.mock('@/lib/api/batches', () => ({
  listBatches: (...args: unknown[]) => mockListBatches(...args),
}));

const empty: BatchListResponse = { data: [], total: 0, limit: 50, offset: 0 };

const oneBatch: BatchListResponse = {
  data: [
    {
      id: 'b-1',
      external_code: '00086',
      status: 'imported',
      rows_imported: 45389,
      rows_rejected: 0,
      total_orders_amount: '1132418.0000',
      total_installments_amount: '1132418.0000',
      imported_at: '2026-04-20T14:30:00.000Z',
      rejection_reason: null,
      uploaded_at: '2026-04-20T14:00:00.000Z',
      uploaded_by: { id: 'u-1', email: 'm@b.com', full_name: 'María' },
    },
  ],
  total: 1,
  limit: 50,
  offset: 0,
};

describe('<BatchesTable />', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the loading skeleton initially', () => {
    mockListBatches.mockReturnValueOnce(new Promise(() => {})); // never resolves
    renderWithQuery(<BatchesTable />);
    expect(screen.getByText(/cargando lotes/i)).toBeInTheDocument();
  });

  it('shows the empty state when data is empty', async () => {
    mockListBatches.mockResolvedValueOnce(empty);
    renderWithQuery(<BatchesTable />);
    await waitFor(() => {
      expect(screen.getByText(/sin lotes todavía/i)).toBeInTheDocument();
    });
  });

  it('shows error state when query fails', async () => {
    mockListBatches.mockRejectedValueOnce(new Error('boom'));
    renderWithQuery(<BatchesTable />);
    await waitFor(() => {
      expect(screen.getByText(/no se pudieron cargar/i)).toBeInTheDocument();
    });
  });

  it('renders rows when data is present', async () => {
    mockListBatches.mockResolvedValueOnce(oneBatch);
    renderWithQuery(<BatchesTable />);
    await waitFor(() => {
      expect(screen.getByText('00086')).toBeInTheDocument();
    });
    expect(screen.getByText('María')).toBeInTheDocument();
    expect(screen.getByText('45,389')).toBeInTheDocument();
    expect(screen.getByText('Activo')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/batches/batches-table.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement `<BatchesTable>`**

Create `/Users/llam/dev/araguaney_front/components/batches/batches-table.tsx`:

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { listBatches } from '@/lib/api/batches';
import { BatchRow } from './batch-row';

const PAGE_LIMIT = 50;

export function BatchesTable() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['batches', { limit: PAGE_LIMIT, offset: 0 }],
    queryFn: () => listBatches({ limit: PAGE_LIMIT, offset: 0 }),
  });

  if (isLoading) return <Skeleton />;
  if (isError) return <ErrorState />;
  if (!data || data.data.length === 0) return <EmptyState />;

  return (
    <div className="bg-card border-border-subtle overflow-hidden rounded-xl border">
      <table className="w-full text-[12.5px]">
        <thead className="bg-subtle">
          <tr>
            <Th>Código</Th>
            <Th>Subido</Th>
            <Th>Por</Th>
            <Th align="right">Órdenes</Th>
            <Th align="right">Capital</Th>
            <Th>Estado</Th>
          </tr>
        </thead>
        <tbody>
          {data.data.map((b) => (
            <BatchRow key={b.id} batch={b} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className={`text-text-3 border-border-subtle border-b px-4 py-2.5 text-${align} text-[9.5px] font-medium tracking-[0.7px] uppercase`}
    >
      {children}
    </th>
  );
}

function Skeleton() {
  return (
    <div className="border-border-subtle bg-card flex h-64 items-center justify-center rounded-xl border">
      <div className="text-text-3 text-sm">Cargando lotes…</div>
    </div>
  );
}

function ErrorState() {
  return (
    <div className="border-border-subtle bg-card flex h-64 items-center justify-center rounded-xl border">
      <div className="text-text-3 text-sm">No se pudieron cargar los lotes. Recarga la página.</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="border-border-subtle bg-card flex h-64 items-center justify-center rounded-xl border">
      <div className="text-center">
        <div className="mb-1 text-base font-semibold">Sin lotes todavía</div>
        <p className="text-text-3 text-sm">Sube un Excel para empezar.</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Confirm tests pass**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/batches/batches-table.test.tsx
```

Expected: 4 tests green.

- [ ] **Step 5: Suite + format check**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 6: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/batches/batches-table.tsx components/batches/batches-table.test.tsx
git commit -m "$(cat <<'EOF'
feat(batches): BatchesTable with TanStack Query + states

Loads ['batches', {limit:50, offset:0}], renders skeleton/error/empty
states, otherwise <table> with <BatchRow> per item.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: `<UploadBatchUploading>`

**Why:** The "validating" stage (spinner) of the upload modal.

**Files:**
- Create: `components/batches/upload-batch-uploading.tsx`
- Create: `components/batches/upload-batch-uploading.test.tsx`

- [ ] **Step 1: Write failing test**

Create `/Users/llam/dev/araguaney_front/components/batches/upload-batch-uploading.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UploadBatchUploading } from './upload-batch-uploading';

describe('<UploadBatchUploading />', () => {
  it('renders the filename inside the loading text', () => {
    render(<UploadBatchUploading filename="lote_w17.xlsx" />);
    expect(screen.getByText(/lote_w17\.xlsx/)).toBeInTheDocument();
  });

  it('renders the secondary message', () => {
    render(<UploadBatchUploading filename="x.xlsx" />);
    expect(screen.getByText(/validando estructura/i)).toBeInTheDocument();
  });

  it('falls back to "el archivo" when filename is empty', () => {
    render(<UploadBatchUploading filename="" />);
    expect(screen.getByText(/subiendo el archivo/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/batches/upload-batch-uploading.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/batches/upload-batch-uploading.tsx`:

```tsx
export function UploadBatchUploading({ filename }: { filename: string }) {
  const label = filename || 'el archivo';
  return (
    <div className="px-7 py-[72px] text-center">
      <div className="border-neutral-bg mx-auto mb-3.5 h-9 w-9 animate-spin rounded-full border-[2.5px] border-t-side" />
      <div className="text-[13px] font-medium">Subiendo {label}…</div>
      <div className="text-text-3 mt-1 text-[11px]">
        Validando estructura, duplicados y reglas de negocio
      </div>
    </div>
  );
}
```

The `animate-spin` is a Tailwind built-in (no custom keyframe needed).

- [ ] **Step 4: Confirm tests pass**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/batches/upload-batch-uploading.test.tsx
```

Expected: 3 tests green.

- [ ] **Step 5: Suite + format check**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 6: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/batches/upload-batch-uploading.tsx components/batches/upload-batch-uploading.test.tsx
git commit -m "$(cat <<'EOF'
feat(batches): UploadBatchUploading spinner stage

Centered spinner + filename + reassuring secondary message.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: `<UploadBatchRecent>`

**Why:** "Lotes recientes" widget shown inside the dropzone (3 most recent batches).

**Files:**
- Create: `components/batches/upload-batch-recent.tsx`
- Create: `components/batches/upload-batch-recent.test.tsx`

- [ ] **Step 1: Write failing test**

Create `/Users/llam/dev/araguaney_front/components/batches/upload-batch-recent.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithQuery } from '@/test/helpers/tanstack';
import { UploadBatchRecent } from './upload-batch-recent';
import type { BatchListResponse } from '@/lib/types/batch';

const mockListBatches = vi.fn();
vi.mock('@/lib/api/batches', () => ({
  listBatches: (...a: unknown[]) => mockListBatches(...a),
}));

const sample: BatchListResponse = {
  data: [
    { id: 'b-1', external_code: '00086', status: 'imported', rows_imported: 45389, rows_rejected: 0, total_orders_amount: '0', total_installments_amount: '0', imported_at: null, rejection_reason: null, uploaded_at: '2026-04-20T00:00:00.000Z', uploaded_by: { id: 'u', email: 'a@b', full_name: 'María' } },
    { id: 'b-2', external_code: '00085', status: 'imported', rows_imported: 12140, rows_rejected: 0, total_orders_amount: '0', total_installments_amount: '0', imported_at: null, rejection_reason: null, uploaded_at: '2026-04-13T00:00:00.000Z', uploaded_by: { id: 'u', email: 'p@b', full_name: 'Pedro' } },
  ],
  total: 2, limit: 3, offset: 0,
};

describe('<UploadBatchRecent />', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the section header and each batch', async () => {
    mockListBatches.mockResolvedValueOnce(sample);
    renderWithQuery(<UploadBatchRecent />);
    await waitFor(() => expect(screen.getByText('Lotes recientes')).toBeInTheDocument());
    expect(screen.getByText(/Lote 00086/)).toBeInTheDocument();
    expect(screen.getByText(/Lote 00085/)).toBeInTheDocument();
    expect(screen.getByText(/45,389 órdenes/)).toBeInTheDocument();
    expect(screen.getByText(/12,140 órdenes/)).toBeInTheDocument();
  });

  it('renders nothing when there are no batches', async () => {
    mockListBatches.mockResolvedValueOnce({ data: [], total: 0, limit: 3, offset: 0 });
    const { container } = renderWithQuery(<UploadBatchRecent />);
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it('queries with limit=3', async () => {
    mockListBatches.mockResolvedValueOnce(sample);
    renderWithQuery(<UploadBatchRecent />);
    await waitFor(() => {
      expect(mockListBatches).toHaveBeenCalledWith({ limit: 3, offset: 0 });
    });
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/batches/upload-batch-recent.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/batches/upload-batch-recent.tsx`:

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { listBatches } from '@/lib/api/batches';
import { fmtDate } from '@/lib/format/date';

export function UploadBatchRecent() {
  const { data } = useQuery({
    queryKey: ['batches', { limit: 3, offset: 0 }],
    queryFn: () => listBatches({ limit: 3, offset: 0 }),
  });

  if (!data || data.data.length === 0) return null;

  return (
    <div className="mt-5">
      <div className="text-text-3 mb-2.5 text-[10px] font-medium tracking-[0.7px] uppercase">
        Lotes recientes
      </div>
      <div>
        {data.data.map((b, i) => (
          <div
            key={b.id}
            className={
              'flex items-center justify-between py-2.5' +
              (i < data.data.length - 1 ? ' border-border-soft border-b' : '')
            }
          >
            <div className="text-[12px]">
              <span className="font-medium">Lote {b.external_code}</span>
              <span className="text-text-3 ml-2.5 text-[11px]">
                {fmtDate(b.uploaded_at)} · {b.uploaded_by?.full_name ?? '—'}
              </span>
            </div>
            <div className="text-text-3 num text-[11px]">
              {b.rows_imported.toLocaleString('en-US')} órdenes
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Confirm tests pass**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/batches/upload-batch-recent.test.tsx
```

Expected: 3 tests green.

- [ ] **Step 5: Suite + format check**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 6: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/batches/upload-batch-recent.tsx components/batches/upload-batch-recent.test.tsx
git commit -m "$(cat <<'EOF'
feat(batches): UploadBatchRecent (3 most recent batches in dropzone)

Reuses ['batches'] cache with a different page key (limit:3) — independent
of the table's main query.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: `<UploadBatchDropzone>`

**Why:** The drag/drop UI + recent batches list. Stage 'idle' / 'error' of the modal.

**Files:**
- Create: `components/batches/upload-batch-dropzone.tsx`
- Create: `components/batches/upload-batch-dropzone.test.tsx`

- [ ] **Step 1: Write failing test**

Create `/Users/llam/dev/araguaney_front/components/batches/upload-batch-dropzone.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithQuery } from '@/test/helpers/tanstack';
import { UploadBatchDropzone } from './upload-batch-dropzone';

vi.mock('@/lib/api/batches', () => ({
  listBatches: vi.fn().mockResolvedValue({ data: [], total: 0, limit: 3, offset: 0 }),
}));

describe('<UploadBatchDropzone />', () => {
  it('renders the prompt text', () => {
    renderWithQuery(<UploadBatchDropzone onPickFile={vi.fn()} error={null} />);
    expect(screen.getByText(/arrastra el archivo o haz click/i)).toBeInTheDocument();
    expect(screen.getByText(/acepta \.xlsx/i)).toBeInTheDocument();
  });

  it('calls onPickFile when a file is dropped', () => {
    const onPickFile = vi.fn();
    const { container } = renderWithQuery(<UploadBatchDropzone onPickFile={onPickFile} error={null} />);
    const dropzone = container.querySelector('[data-testid="dropzone"]')!;
    const file = new File(['x'], 'test.xlsx');
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
    expect(onPickFile).toHaveBeenCalledWith(file);
  });

  it('renders an inline error when error prop is set', () => {
    renderWithQuery(<UploadBatchDropzone onPickFile={vi.fn()} error="Archivo inválido" />);
    expect(screen.getByText('Archivo inválido')).toBeInTheDocument();
  });

  it('does not render inline error when error is null', () => {
    renderWithQuery(<UploadBatchDropzone onPickFile={vi.fn()} error={null} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/batches/upload-batch-dropzone.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/components/batches/upload-batch-dropzone.tsx`:

```tsx
'use client';

import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { UploadBatchRecent } from './upload-batch-recent';

interface Props {
  onPickFile: (file: File) => void;
  error: string | null;
}

export function UploadBatchDropzone({ onPickFile, error }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onPickFile(file);
  }

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onPickFile(file);
  }

  return (
    <div className="px-7 py-7">
      {error && (
        <div role="alert" className="bg-warn-bg text-warn-text mb-3 rounded-md px-3 py-2 text-[12px]">
          {error}
        </div>
      )}

      <div
        data-testid="dropzone"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={
          'cursor-pointer rounded-xl border-[1.5px] border-dashed px-6 py-14 text-center transition-colors ' +
          (dragOver ? 'border-side bg-yellow/30' : 'border-black/20 bg-subtle')
        }
      >
        <input ref={inputRef} type="file" accept=".xlsx" onChange={onChange} className="hidden" />
        <div className="bg-card border-border-strong relative mx-auto mb-3.5 flex h-[54px] w-[46px] items-end justify-center rounded-md border-[0.5px] p-1.5">
          <div className="absolute top-1.5 right-1.5 left-1.5 flex h-[18px] items-center justify-center rounded-sm bg-[#1F6E43] text-[9px] font-semibold tracking-wide text-white">
            XLS
          </div>
        </div>
        <div className="mb-1 text-[14px] font-medium">
          Arrastra el archivo o haz click para seleccionarlo
        </div>
        <div className="text-text-3 text-[12px]">Acepta .xlsx · hasta 10 MB</div>
      </div>

      <UploadBatchRecent />
    </div>
  );
}
```

- [ ] **Step 4: Confirm tests pass**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/batches/upload-batch-dropzone.test.tsx
```

Expected: 4 tests green.

- [ ] **Step 5: Suite + format check**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 6: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/batches/upload-batch-dropzone.tsx components/batches/upload-batch-dropzone.test.tsx
git commit -m "$(cat <<'EOF'
feat(batches): UploadBatchDropzone (drag/drop + recent + inline error)

Stage 'idle' / 'error' of the upload modal. XLS-styled glyph,
visual feedback on drag-over, fallback click to file picker.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: `<UploadBatchModal>`

**Why:** The full upload modal — orchestrates mutation, stages, error handling, success toast.

**Files:**
- Create: `components/batches/upload-batch-modal.tsx`
- Create: `components/batches/upload-batch-modal.test.tsx`

- [ ] **Step 1: Write failing test**

Create `/Users/llam/dev/araguaney_front/components/batches/upload-batch-modal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/test/helpers/tanstack';
import { UploadBatchModal } from './upload-batch-modal';

const mockUploadBatch = vi.fn();
const mockListBatches = vi.fn().mockResolvedValue({ data: [], total: 0, limit: 3, offset: 0 });
vi.mock('@/lib/api/batches', () => ({
  uploadBatch: (...a: unknown[]) => mockUploadBatch(...a),
  listBatches: (...a: unknown[]) => mockListBatches(...a),
}));

const toastSuccess = vi.fn();
vi.mock('sonner', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a) },
}));

class FakeApiError extends Error {
  constructor(public status: number, public body: unknown) { super(); this.name = 'ApiError'; }
}
vi.mock('@/lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/client')>('@/lib/api/client');
  return { ...actual, ApiError: FakeApiError };
});

describe('<UploadBatchModal />', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the dropzone initially (idle stage)', () => {
    renderWithQuery(<UploadBatchModal onClose={vi.fn()} />);
    expect(screen.getByText(/arrastra el archivo/i)).toBeInTheDocument();
  });

  it('rejects a non-xlsx file with inline error and does not call uploadBatch', () => {
    renderWithQuery(<UploadBatchModal onClose={vi.fn()} />);
    const dropzone = screen.getByTestId('dropzone');
    const pdfFile = new File(['x'], 'test.pdf', { type: 'application/pdf' });
    fireEvent.drop(dropzone, { dataTransfer: { files: [pdfFile] } });
    expect(screen.getByText(/formato no soportado/i)).toBeInTheDocument();
    expect(mockUploadBatch).not.toHaveBeenCalled();
  });

  it('rejects a >10MB xlsx with inline error', () => {
    renderWithQuery(<UploadBatchModal onClose={vi.fn()} />);
    const dropzone = screen.getByTestId('dropzone');
    // 11MB
    const big = new File([new Blob([new Uint8Array(11 * 1024 * 1024)])], 'big.xlsx');
    fireEvent.drop(dropzone, { dataTransfer: { files: [big] } });
    expect(screen.getByText(/excede 10 mb/i)).toBeInTheDocument();
    expect(mockUploadBatch).not.toHaveBeenCalled();
  });

  it('on valid file: calls uploadBatch, then on success toasts and closes', async () => {
    const onClose = vi.fn();
    mockUploadBatch.mockResolvedValueOnce({
      external_code: '00086',
      rows_imported: 45389,
    });
    renderWithQuery(<UploadBatchModal onClose={onClose} />);
    const dropzone = screen.getByTestId('dropzone');
    const file = new File([new Blob([new Uint8Array(100)])], 'lote.xlsx');
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    await waitFor(() => expect(mockUploadBatch).toHaveBeenCalled());
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('shows the back error message on 4xx', async () => {
    mockUploadBatch.mockRejectedValueOnce(new FakeApiError(400, { message: 'Excel mal formado' }));
    renderWithQuery(<UploadBatchModal onClose={vi.fn()} />);
    const dropzone = screen.getByTestId('dropzone');
    const file = new File([new Blob([new Uint8Array(100)])], 'lote.xlsx');
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
    await waitFor(() => expect(screen.getByText('Excel mal formado')).toBeInTheDocument());
  });

  it('shows generic error when network error (no ApiError)', async () => {
    mockUploadBatch.mockRejectedValueOnce(new Error('Network down'));
    renderWithQuery(<UploadBatchModal onClose={vi.fn()} />);
    const dropzone = screen.getByTestId('dropzone');
    const file = new File([new Blob([new Uint8Array(100)])], 'lote.xlsx');
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
    await waitFor(() => expect(screen.getByText(/error de red/i)).toBeInTheDocument());
  });

  it('clicking the backdrop calls onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = renderWithQuery(<UploadBatchModal onClose={onClose} />);
    const backdrop = container.querySelector('[data-testid="modal-backdrop"]')!;
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/batches/upload-batch-modal.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement `<UploadBatchModal>`**

Create `/Users/llam/dev/araguaney_front/components/batches/upload-batch-modal.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { uploadBatch } from '@/lib/api/batches';
import { ApiError } from '@/lib/api/client';
import { UploadBatchDropzone } from './upload-batch-dropzone';
import { UploadBatchUploading } from './upload-batch-uploading';

const MAX_BYTES = 10 * 1024 * 1024;

export function UploadBatchModal({ onClose }: { onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string>('');
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: uploadBatch,
    onSuccess: (batch) => {
      queryClient.invalidateQueries({ queryKey: ['batches'] });
      toast.success(
        `Lote ${batch.external_code} ingresado · ${batch.rows_imported.toLocaleString('en-US')} órdenes`,
      );
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        const body = err.body as { message?: string } | null;
        setError(body?.message ?? 'No se pudo subir el lote');
      } else {
        setError('Error de red. Intenta de nuevo.');
      }
    },
  });

  function pickFile(file: File) {
    if (!/\.xlsx$/i.test(file.name)) return setError('Formato no soportado. Solo .xlsx.');
    if (file.size > MAX_BYTES) return setError('Archivo excede 10 MB.');
    if (file.size === 0) return setError('Archivo vacío.');
    setError(null);
    setFilename(file.name);
    mutation.mutate({ file });
  }

  const stage = mutation.status === 'pending' ? 'pending' : 'idle';

  return (
    <div
      data-testid="modal-backdrop"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-12"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-card w-full max-w-[680px] overflow-hidden rounded-xl"
      >
        <div className="border-border-subtle flex items-start justify-between gap-4 border-b px-7 py-5">
          <div>
            <h2 className="text-[18px] font-semibold tracking-[-0.2px]">Subir lote de órdenes</h2>
            <div className="text-text-3 mt-1 text-[12px]">
              Adjunta el Excel exportado del backoffice de Cashea. Las órdenes ingresan al stock disponible para empaquetarse en certificados.
            </div>
          </div>
          <button
            onClick={onClose}
            className="bg-sweep-bg text-text-2 flex h-7 w-7 items-center justify-center rounded-[7px] text-[14px]"
          >
            ×
          </button>
        </div>

        {stage === 'idle' && <UploadBatchDropzone onPickFile={pickFile} error={error} />}
        {stage === 'pending' && <UploadBatchUploading filename={filename} />}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Confirm tests pass**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/batches/upload-batch-modal.test.tsx
```

Expected: 7 tests green.

If a test about generic-error message fails because `pnpm-lock.yaml`'s `vi.importActual<>` syntax differs in vitest 4: simplify the mock to just `vi.mock('@/lib/api/client', () => ({ ApiError: FakeApiError }))` without spreading actual.

- [ ] **Step 5: Suite + format check**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 6: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/batches/upload-batch-modal.tsx components/batches/upload-batch-modal.test.tsx
git commit -m "$(cat <<'EOF'
feat(batches): UploadBatchModal (mutation + stages + error handling)

Single-step upload: pick file → client validates extension/size → mutate
→ on success toast + invalidate ['batches'] + onClose. on error 4xx
shows back's message inline; on network error generic message.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: `<BatchesPage>` + wire `/batches` route

**Why:** The orchestrator that combines header + table + modal, mounted by the route.

**Files:**
- Create: `components/batches/batches-page.tsx`
- Modify: `app/(app)/batches/page.tsx`

- [ ] **Step 1: Implement `<BatchesPage>`**

Create `/Users/llam/dev/araguaney_front/components/batches/batches-page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { BatchesTable } from './batches-table';
import { UploadBatchModal } from './upload-batch-modal';
import { UploadButton } from './upload-button';

export function BatchesPage() {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="mx-auto w-full max-w-[1440px] px-9 py-7">
      <PageHeader
        breadcrumb={{ section: 'Datos', current: 'Lotes' }}
        title="Lotes"
        actions={<UploadButton onClick={() => setModalOpen(true)} />}
      />
      <BatchesTable />
      {modalOpen && <UploadBatchModal onClose={() => setModalOpen(false)} />}
    </div>
  );
}
```

- [ ] **Step 2: Replace `/batches` route**

Read current `/Users/llam/dev/araguaney_front/app/(app)/batches/page.tsx` (the stub from Slice 1). Replace its contents with:

```tsx
import { BatchesPage } from '@/components/batches/batches-page';

export default function BatchesRoute() {
  return <BatchesPage />;
}
```

- [ ] **Step 3: Verify suite + format check**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

Expected: all clean. The existing stub-page test (if any) still passes — we kept `BatchesPage` as the named export from `<BatchesPage>` component.

- [ ] **Step 4: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/batches/batches-page.tsx 'app/(app)/batches/page.tsx'
git commit -m "$(cat <<'EOF'
feat(batches): wire /batches route to BatchesPage

Drops the Slice 1 ComingSoon stub. Page renders PageHeader +
UploadButton + BatchesTable + UploadBatchModal (controlled via
local state).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 19: Local smoke + visual sanity

**Why:** Catch any wiring issues before pushing. Confirm the full flow renders + behaves correctly against a local dev build.

**Files:** none (verification only).

**Pre-req:** `.env.local` from earlier slices already has `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

- [ ] **Step 1: Boot dev**

```bash
cd /Users/llam/dev/araguaney_front
lsof -ti:3000 | xargs kill -9 2>/dev/null
pnpm dev > /tmp/front-task19.log 2>&1 &
PID=$!
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if grep -q "Ready in" /tmp/front-task19.log 2>/dev/null; then echo "ready in ${i}s"; break; fi
  sleep 1
done
```

- [ ] **Step 2: Verify route gating**

```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3000/batches
# Expected: 307 → /login
```

- [ ] **Step 3: Visual flow in browser**

Login as operator → `/cycle` → click "Lotes" in sidebar → land on `/batches`.

Verify:
- Sidebar `Lotes` is highlighted (yellow bar)
- Topbar: breadcrumb "Datos · **Lotes**", h1 "Lotes", "Subir lote" button visible (operator has permission)
- Table shows skeleton briefly, then rows OR "Sin lotes todavía" empty state
- Click "Subir lote" → modal opens, dropzone visible, "Lotes recientes" widget renders if there are batches
- Drag a `.pdf` file → inline error "Formato no soportado. Solo .xlsx."
- Drag a `.xlsx` < 10MB → spinner stage → either:
  - Success: toast bottom-right "Lote {code} ingresado · {N} órdenes" + modal closes + table refreshes with new row
  - Failure: error message inline (back rejected)

Then login as auditor → `/batches` → "Subir lote" button is **not** visible.

- [ ] **Step 4: Stop dev**

```bash
kill $PID; wait $PID 2>/dev/null
```

- [ ] **Step 5: No commit**

Verification only.

---

## Task 20: Push branch + open PR

**Files:** none (git/GitHub).

- [ ] **Step 1: Push**

```bash
cd /Users/llam/dev/araguaney_front
git push -u origin feat/slice-2-batches
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "feat: Slice 2 — /batches (upload modal + list)" --body "$(cat <<'EOF'
## Summary

First business feature on the front: `/batches` page with list of historic batches and modal to upload an Excel file. Conecta con back's `/api/batches` (POST + GET).

## What's new

**Utilities:**
- `lib/format/money.ts` — `fmtMoney`, `fmtMoney2`
- `lib/format/date.ts` — `fmtDate` (ISO → DD/MM/YYYY)
- `lib/permissions/has-permission.ts` — role × permission map (mirror of cfb.role_permissions)
- `lib/auth/user-context.tsx` — `<UserProvider>` + `useUser()` for client components

**Types + API:**
- `lib/types/batch.ts` — hand-typed BatchSummary etc. (back openapi gap)
- `lib/api/client.ts` — skip content-type for FormData (multipart fix)
- `lib/api/batches.ts` — `listBatches`, `uploadBatch`

**Components:**
- `components/ui/pill.tsx` — reusable status pill (5 variants)
- `components/batches/` — 8 components (page, table, row, status pill, upload button, modal + 3 modal stages)

**Wiring:**
- `app/(app)/batches/page.tsx` replaces Slice 1 ComingSoon stub
- `<AppShell>` wraps children in `<UserProvider value={user}>`
- Root layout mounts `<Toaster />` from sonner

## Test Plan

- [x] `pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check && pnpm build` — all clean
- [x] Local smoke: route gating + full upload flow (operator) + permission gating (auditor)
- [ ] Vercel preview deploy renders without console errors
- [ ] Real Excel upload against production back

## Notes

- Single-step upload (no preview-then-confirm). Spec Q2.
- Back endpoints `/api/batches*` lack response schemas → hand-typed shapes. Follow-up: back adds `@ApiResponse` decorators.
- Detail page `/batches/{id}`, filters, pagination → Slice 2b.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

If gh fails with "must be a collaborator", open the PR manually at the URL printed by the push.

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

- ✅ Goal: `/batches` page with list + upload modal — Tasks 13, 17, 18
- ✅ TanStack Query in real use — Tasks 13 (query), 17 (mutation), 15 (recent widget)
- ✅ Upload validations client-side (extension, size, empty) — Task 17
- ✅ FormData skip content-type — Task 6
- ✅ Hand-typed shapes — Task 6
- ✅ Money/date formatters — Tasks 2, 3
- ✅ Permission gating — Tasks 4, 12
- ✅ UserProvider context — Task 5
- ✅ Pill primitive + status mapping — Tasks 9, 10
- ✅ Table row + skeleton/error/empty — Tasks 11, 13
- ✅ Modal with stages + error handling — Tasks 14, 16, 17
- ✅ Recent batches widget — Task 15
- ✅ Toast on success — Tasks 1 (sonner) + 17 (mutation onSuccess)
- ✅ Cache invalidate on success — Task 17
- ✅ Route wiring — Task 18
- ✅ Smoke + PR — Tasks 19, 20

**Placeholder scan:** No `TODO`/`TBD`/`fill in` markers. The mock test data uses concrete sample values.

**Type consistency:**
- `BatchSummary` defined in Task 6 used identically in Tasks 7, 11, 13, 15, 17 ✓
- `BatchListResponse` shape matches across api/batches and table tests ✓
- `MeUser` from `@/lib/api/me` used by user-context (Task 5), permissions (Task 4), upload-button (Task 12) ✓
- `<UploadBatchDropzone>` `onPickFile`/`error` props match the consumer in Task 17 ✓
- `<UploadBatchUploading>` `filename` prop matches consumer in Task 17 ✓
- `<UploadButton>` `onClick` prop matches consumer in Task 18 ✓
- `<Pill>` variant type used by `<BatchStatusPill>` (Task 10) is exported from Task 9 ✓
- `mutation.status` literal `'pending'` checked in Task 17 (TanStack Query v5 uses `'pending'` not `'loading'`) ✓

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-08-front-slice-2-batches.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, two-stage review (spec compliance + code quality) between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session with batch checkpoints.

**Which approach?**
