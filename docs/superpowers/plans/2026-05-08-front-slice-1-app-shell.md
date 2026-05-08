# araguaney_front Slice 1 — App Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the authenticated app shell of `araguaney_front` — sidebar (220px dark) + topbar (breadcrumb + h1 + actions slot) + 9 stub routes — replicating the Claude Design mockup pixel-perfect.

**Architecture:** Server-first Next.js 16 App Router. Tailwind v4 design tokens via `@theme`. Single `<AppShell>` wraps all `(app)/*` routes via the route group layout. One client-side component (`<SidebarNav>` for `usePathname`); everything else is RSC-friendly. Role-based menu visibility driven by `lib/nav/nav-config.ts`.

**Tech Stack:** Next.js 16, React 19, TypeScript 5 strict, Tailwind v4 (with `@theme`), shadcn/ui base-nova (re-themed via CSS vars), Vitest + Testing Library, pnpm 10.

**Spec:** `docs/superpowers/specs/2026-05-08-front-slice-1-app-shell-design.md`

**Working directory note:** All code changes happen in `/Users/llam/dev/araguaney_front/`. The plan and spec live in `/Users/llam/dev/araguaney_back/docs/`. Implementer must `cd /Users/llam/dev/araguaney_front` before running any task command.

**Pre-req branch:** Implementer creates and works on a single feature branch `feat/slice-1-app-shell`. All commits land there. PR is opened at the end.

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `app/globals.css` | modify | Design tokens via `@theme` + Google Fonts + body baseline + shadcn override |
| `lib/nav/nav-config.ts` | create | Single source of truth for nav sections + items + role rules |
| `lib/nav/nav-config.test.ts` | create | Filter logic per role |
| `components/layout/coming-soon.tsx` | create | Centered placeholder for stub pages |
| `components/layout/coming-soon.test.tsx` | create | Default + custom message |
| `components/layout/page-header.tsx` | create | Breadcrumb + h1 + actions slot |
| `components/layout/page-header.test.tsx` | create | Renders, actions optional |
| `components/layout/sidebar-logo.tsx` | create | Yellow A square + Araguaney text |
| `components/layout/sidebar-logo.test.tsx` | create | Smoke |
| `components/layout/sidebar-user.tsx` | create | Initials avatar + name + role label (ES) |
| `components/layout/sidebar-user.test.tsx` | create | Initials computation + role labels |
| `components/layout/sidebar-nav-item.tsx` | create | `<Link>` with active styling (yellow bar) |
| `components/layout/sidebar-nav-item.test.tsx` | create | Active vs inactive rendering |
| `components/layout/sidebar-nav-section.tsx` | create | Section title + filtered items |
| `components/layout/sidebar-nav-section.test.tsx` | create | Filter empty → null |
| `components/layout/sidebar-nav.tsx` | create | Client component, `usePathname`, role filtering |
| `components/layout/sidebar-nav.test.tsx` | create | Per-role visible item counts |
| `components/layout/sidebar.tsx` | create | Composition: logo + nav + user + logout button |
| `components/layout/app-shell.tsx` | create | Grid layout: sidebar | main |
| `components/layout/app-shell.test.tsx` | create | Integration: shell + page placeholder |
| `app/(app)/layout.tsx` | modify | Wrap children in `<AppShell>` |
| `app/(app)/page.tsx` | modify | Redirect to `/cycle` |
| `app/(app)/cycle/page.tsx` | create | Placeholder |
| `app/(app)/certificates/page.tsx` | create | Placeholder |
| `app/(app)/stock/page.tsx` | create | Placeholder |
| `app/(app)/investors/page.tsx` | create | Placeholder |
| `app/(app)/batches/page.tsx` | create | Placeholder |
| `app/(app)/merchants/page.tsx` | create | Placeholder |
| `app/(app)/audit/page.tsx` | create | Placeholder |
| `app/(app)/traceability/page.tsx` | create | Placeholder |
| `app/(app)/users/page.tsx` | create | Placeholder |

**Manual operational tasks** (no code):

| Action | Owner | When |
|---|---|---|
| Push branch + create PR | controller | Task 15 |
| Review PR + merge | user | After Task 15 |
| Verify Vercel deploy + visual smoke in browser | user + controller | Post-merge |

---

## Task 1: Design tokens in globals.css

**Why:** Every visual decision downstream depends on these tokens. Without them, the components have no colors to reference.

**Files:**
- Modify: `app/globals.css` (replace contents)

- [ ] **Step 1: Replace `app/globals.css` with the new contents below**

The new file integrates: Tailwind import + Google Fonts + design tokens via `@theme` + shadcn `:root` override pointing to our tokens + body baseline. Use the Write tool to overwrite the file.

```css
@import 'tailwindcss';
@import 'tw-animate-css';
@import 'shadcn/tailwind.css';
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

@custom-variant dark (&:is(.dark *));

/* Cashea CFB design tokens — extracted from Claude Design mockup */
@theme {
  /* Surfaces */
  --color-bg: #FAFAF7;
  --color-card: #FEFEFE;
  --color-hover: #F0EFEA;
  --color-subtle: #FAFAF7;

  /* Text */
  --color-text: #1A1A1A;
  --color-text-2: #6B6B66;
  --color-text-3: #8A8A85;

  /* Borders */
  --color-border-subtle: rgba(0, 0, 0, 0.08);
  --color-border-strong: rgba(0, 0, 0, 0.18);
  --color-border-soft: rgba(0, 0, 0, 0.04);

  /* Sidebar (dark) */
  --color-side: #0A0A0A;
  --color-side-text: rgba(254, 254, 254, 0.7);
  --color-side-active: rgba(254, 254, 254, 0.08);
  --color-side-hover: rgba(254, 254, 254, 0.05);

  /* Accent */
  --color-yellow: #FDFA3D;

  /* Status pills (used in Slice 2+) */
  --color-green-bg: #EAF3DE;
  --color-green-text: #3B6D11;
  --color-green-dot: #639922;
  --color-green-deep: #27500A;
  --color-warn-bg: #FAEEDA;
  --color-warn-text: #633806;
  --color-warn-dot: #BA7517;
  --color-warn-border: #EDB957;
  --color-info-bg: #E8F1F7;
  --color-info-text: #2B5572;
  --color-neutral-bg: #F0EFEA;
  --color-neutral-text: #6B6B66;
  --color-sweep-bg: #F3F2EC;
  --color-sweep-text: #5F5E5A;
  --color-sweep-dot: #888780;
  --color-sweep-border: #B4B2A9;

  /* Type */
  --font-sans: 'Poppins', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-sidebar-ring: var(--sidebar-ring);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar: var(--sidebar);
  --color-chart-5: var(--chart-5);
  --color-chart-4: var(--chart-4);
  --color-chart-3: var(--chart-3);
  --color-chart-2: var(--chart-2);
  --color-chart-1: var(--chart-1);
  --color-ring: var(--ring);
  --color-input: var(--input);
  --color-border: var(--border);
  --color-destructive: var(--destructive);
  --color-accent-foreground: var(--accent-foreground);
  --color-accent: var(--accent);
  --color-muted-foreground: var(--muted-foreground);
  --color-muted: var(--muted);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-secondary: var(--secondary);
  --color-primary-foreground: var(--primary-foreground);
  --color-primary: var(--primary);
  --color-popover-foreground: var(--popover-foreground);
  --color-popover: var(--popover);
  --color-card-foreground: var(--card-foreground);
  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.4);
  --radius-2xl: calc(var(--radius) * 1.8);
  --radius-3xl: calc(var(--radius) * 2.2);
  --radius-4xl: calc(var(--radius) * 2.6);
}

:root {
  /* Override shadcn base-nova tokens to point at our design colors */
  --background: var(--color-bg);
  --foreground: var(--color-text);
  --card: var(--color-card);
  --card-foreground: var(--color-text);
  --popover: var(--color-card);
  --popover-foreground: var(--color-text);
  --primary: var(--color-side);
  --primary-foreground: #FEFEFE;
  --secondary: var(--color-card);
  --secondary-foreground: var(--color-text);
  --muted: var(--color-hover);
  --muted-foreground: var(--color-text-3);
  --accent: var(--color-hover);
  --accent-foreground: var(--color-text);
  --destructive: oklch(0.577 0.245 27.325);
  --border: var(--color-border-strong);
  --input: var(--color-border-strong);
  --ring: var(--color-side);
  --chart-1: oklch(0.87 0 0);
  --chart-2: oklch(0.556 0 0);
  --chart-3: oklch(0.439 0 0);
  --chart-4: oklch(0.371 0 0);
  --chart-5: oklch(0.269 0 0);
  --radius: 0.5rem;
  --sidebar: var(--color-side);
  --sidebar-foreground: var(--color-side-text);
  --sidebar-primary: var(--color-yellow);
  --sidebar-primary-foreground: var(--color-side);
  --sidebar-accent: var(--color-side-active);
  --sidebar-accent-foreground: #FEFEFE;
  --sidebar-border: rgba(254, 254, 254, 0.08);
  --sidebar-ring: var(--color-yellow);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  html {
    font-family: var(--font-sans);
  }
  body {
    background: var(--color-bg);
    color: var(--color-text);
    font-size: 13px;
    line-height: 1.45;
    -webkit-font-smoothing: antialiased;
  }
}

/* Tabular numerics helper for tables (Slice 2+) */
.num {
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 2: Verify build still works**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm build
```

Expected: 0 errors. The build verifies that the new `@theme` syntax + Google Fonts URL is valid.

If `pnpm build` fails because of `@import url(...)` ordering, move the Google Fonts import to be the FIRST `@import` line in the file.

If lint complains about anything in `globals.css`, run `pnpm format` and re-check.

- [ ] **Step 3: Smoke test the dev server visually**

```bash
cd /Users/llam/dev/araguaney_front
pnpm dev > /tmp/front-task1.log 2>&1 &
PID=$!
for i in 1 2 3 4 5 6 7 8 9 10; do
  if grep -q "Ready in" /tmp/front-task1.log 2>/dev/null; then break; fi
  sleep 1
done
curl -s http://localhost:3000/login | grep -E "Cashea|Poppins" | head -3
kill $PID; wait $PID 2>/dev/null
```

Expected: HTML contains `Cashea CFB` (title is unchanged). The login page now uses Poppins via the new font-sans token. No visual regression — the existing login page should still render.

- [ ] **Step 4: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git checkout -b feat/slice-1-app-shell
git add app/globals.css
git commit -m "$(cat <<'EOF'
feat(theme): add Cashea CFB design tokens via Tailwind v4 @theme

- Color tokens (--color-bg, --color-side, --color-yellow, etc.)
- Typography tokens (Poppins UI, JetBrains Mono numbers via Google Fonts)
- Border + status pill tokens (used in Slice 2+)
- shadcn base-nova :root re-pointed to our design colors so existing
  primitives (Button, Card) auto-match the design without prop changes

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Nav config

**Why:** Single source of truth for sidebar items + role rules. Must exist before any nav component because they all import from it.

**Files:**
- Create: `lib/nav/nav-config.ts`
- Create: `lib/nav/nav-config.test.ts`

- [ ] **Step 1: Write failing test**

Create dir + test:

```bash
cd /Users/llam/dev/araguaney_front
mkdir -p lib/nav
```

Create `/Users/llam/dev/araguaney_front/lib/nav/nav-config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { NAV_SECTIONS, type NavSection, type NavItem } from './nav-config';
import type { MeUser } from '@/lib/api/me';

type Role = MeUser['role'];

function visibleItemsForRole(role: Role): { section: string; item: string }[] {
  const out: { section: string; item: string }[] = [];
  for (const section of NAV_SECTIONS) {
    if (!section.allowedRoles.includes(role)) continue;
    for (const item of section.items) {
      if (item.allowedRoles && !item.allowedRoles.includes(role)) continue;
      out.push({ section: section.title, item: item.label });
    }
  }
  return out;
}

describe('NAV_SECTIONS', () => {
  it('has the 3 expected section titles in order', () => {
    expect(NAV_SECTIONS.map((s) => s.title)).toEqual(['Operación', 'Datos', 'Sistema']);
  });

  it('has 9 unique routes across all sections', () => {
    const all = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.href));
    expect(all).toHaveLength(9);
    expect(new Set(all).size).toBe(9);
  });

  it('admin sees all 9 items across 3 sections', () => {
    const visible = visibleItemsForRole('admin');
    expect(visible).toHaveLength(9);
  });

  it('auditor sees 8 items (no Usuarios) across 3 sections', () => {
    const visible = visibleItemsForRole('auditor');
    expect(visible).toHaveLength(8);
    expect(visible.find((v) => v.item === 'Usuarios')).toBeUndefined();
  });

  it('operator sees 6 items across 2 sections (no Sistema)', () => {
    const visible = visibleItemsForRole('operator');
    expect(visible).toHaveLength(6);
    expect(visible.find((v) => v.section === 'Sistema')).toBeUndefined();
  });

  it('every item has a unique key', () => {
    const keys = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.key));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/nav/nav-config.test.ts
```

Expected: FAIL — `./nav-config` doesn't exist.

- [ ] **Step 3: Implement `lib/nav/nav-config.ts`**

Create `/Users/llam/dev/araguaney_front/lib/nav/nav-config.ts`:

```ts
import type { MeUser } from '@/lib/api/me';

type Role = MeUser['role'];

export interface NavItem {
  key: string;
  label: string;
  href: string;
  /** Roles that can see this item. Undefined = all authenticated. */
  allowedRoles?: readonly Role[];
}

export interface NavSection {
  title: string;
  /** Roles that can see this section (any item still applies its own filter). */
  allowedRoles: readonly Role[];
  items: readonly NavItem[];
}

const ALL_ROLES = ['operator', 'admin', 'auditor'] as const;

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    title: 'Operación',
    allowedRoles: ALL_ROLES,
    items: [
      { key: 'cycle', label: 'Panel del ciclo', href: '/cycle' },
      { key: 'certificates', label: 'Certificados', href: '/certificates' },
      { key: 'stock', label: 'Stock de órdenes', href: '/stock' },
      { key: 'investors', label: 'Inversores', href: '/investors' },
    ],
  },
  {
    title: 'Datos',
    allowedRoles: ALL_ROLES,
    items: [
      { key: 'batches', label: 'Lotes', href: '/batches' },
      { key: 'merchants', label: 'Comercios', href: '/merchants' },
    ],
  },
  {
    title: 'Sistema',
    allowedRoles: ['admin', 'auditor'],
    items: [
      { key: 'audit', label: 'Auditoría', href: '/audit' },
      { key: 'traceability', label: 'Trazabilidad', href: '/traceability' },
      { key: 'users', label: 'Usuarios', href: '/users', allowedRoles: ['admin'] },
    ],
  },
] as const;
```

- [ ] **Step 4: Confirm tests pass**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/nav/nav-config.test.ts
```

Expected: 6 tests green.

- [ ] **Step 5: Verify full suite + lint + format + typecheck**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

Expected: all pass. If format fails, run `pnpm format` and re-check.

- [ ] **Step 6: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add lib/nav/
git commit -m "$(cat <<'EOF'
feat(nav): single source of truth for sidebar items + role rules

NAV_SECTIONS: 3 sections (Operación, Datos, Sistema) × 9 items.
Role rules:
- operator → 6 items (no Sistema)
- auditor  → 8 items (no Usuarios)
- admin    → 9 items

Sidebar components consume this; no role logic gets duplicated.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `<ComingSoon>` placeholder

**Why:** Used by all 9 stub pages. Smallest unit, no dependencies.

**Files:**
- Create: `components/layout/coming-soon.tsx`
- Create: `components/layout/coming-soon.test.tsx`

- [ ] **Step 1: Write failing test**

```bash
cd /Users/llam/dev/araguaney_front
mkdir -p components/layout
```

Create `/Users/llam/dev/araguaney_front/components/layout/coming-soon.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComingSoon } from './coming-soon';

describe('<ComingSoon />', () => {
  it('renders a "Próximamente" heading and the default message', () => {
    render(<ComingSoon />);
    expect(screen.getByText('Próximamente')).toBeInTheDocument();
    expect(screen.getByText(/disponible en próximos slices/i)).toBeInTheDocument();
  });

  it('renders a custom message when provided', () => {
    render(<ComingSoon message="Pronto verás listados de certificados." />);
    expect(screen.getByText('Pronto verás listados de certificados.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/layout/coming-soon.test.tsx
```

Expected: FAIL — `./coming-soon` doesn't exist.

- [ ] **Step 3: Implement `<ComingSoon>`**

Create `/Users/llam/dev/araguaney_front/components/layout/coming-soon.tsx`:

```tsx
interface Props {
  message?: string;
}

export function ComingSoon({
  message = 'Esta sección estará disponible en próximos slices.',
}: Props) {
  return (
    <div className="flex items-center justify-center py-24">
      <div className="max-w-md text-center">
        <div className="mb-2 text-2xl font-semibold">Próximamente</div>
        <p className="text-text-3 text-sm">{message}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Confirm tests pass**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/layout/coming-soon.test.tsx
```

Expected: 2 tests green.

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/layout/coming-soon.tsx components/layout/coming-soon.test.tsx
git commit -m "$(cat <<'EOF'
feat(layout): ComingSoon placeholder for stub pages

Centered "Próximamente" with optional custom message.
Used by all 9 sidebar route stubs in Slice 1.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `<PageHeader>`

**Why:** Reusable pattern: breadcrumb + h1 + actions slot. Every page uses it.

**Files:**
- Create: `components/layout/page-header.tsx`
- Create: `components/layout/page-header.test.tsx`

- [ ] **Step 1: Write failing test**

Create `/Users/llam/dev/araguaney_front/components/layout/page-header.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageHeader } from './page-header';

describe('<PageHeader />', () => {
  it('renders breadcrumb section + current with current bolded', () => {
    render(<PageHeader breadcrumb={{ section: 'Operación', current: 'Panel del ciclo' }} title="Panel del ciclo" />);
    // Section text appears
    expect(screen.getByText(/Operación/)).toBeInTheDocument();
    // Current is rendered inside a <b> element
    const current = screen.getByText('Panel del ciclo', { selector: 'b' });
    expect(current).toBeInTheDocument();
  });

  it('renders the title as an h1', () => {
    render(<PageHeader breadcrumb={{ section: 'Datos', current: 'Lotes' }} title="Lotes" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Lotes' })).toBeInTheDocument();
  });

  it('renders actions when provided', () => {
    render(
      <PageHeader
        breadcrumb={{ section: 'Operación', current: 'Panel del ciclo' }}
        title="Panel del ciclo"
        actions={<button>Subir lote</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Subir lote' })).toBeInTheDocument();
  });

  it('does not render actions wrapper when actions absent', () => {
    const { container } = render(
      <PageHeader breadcrumb={{ section: 'Datos', current: 'Lotes' }} title="Lotes" />,
    );
    // No buttons present
    expect(container.querySelector('button')).toBeNull();
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/layout/page-header.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement `<PageHeader>`**

Create `/Users/llam/dev/araguaney_front/components/layout/page-header.tsx`:

```tsx
import { cn } from '@/lib/utils';

interface Props {
  breadcrumb: { section: string; current: string };
  title: string;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({ breadcrumb, title, actions, className }: Props) {
  return (
    <div className={cn('mb-[22px] flex items-center justify-between', className)}>
      <div>
        <div className="text-text-3 mb-1.5 text-[11px]">
          {breadcrumb.section} · <b className="text-text font-medium">{breadcrumb.current}</b>
        </div>
        <h1 className="text-[22px] font-semibold leading-[1.2] tracking-[-0.4px]">{title}</h1>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Confirm tests pass**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/layout/page-header.test.tsx
```

Expected: 4 tests green.

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/layout/page-header.tsx components/layout/page-header.test.tsx
git commit -m "$(cat <<'EOF'
feat(layout): PageHeader (breadcrumb + h1 + actions slot)

Used by every page in (app)/ to render the top section.
Format: "Section · **Current**" + h1 + optional right-aligned actions.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `<SidebarLogo>`

**Why:** Logo block in the sidebar. Pixel-fixed (no props).

**Files:**
- Create: `components/layout/sidebar-logo.tsx`
- Create: `components/layout/sidebar-logo.test.tsx`

- [ ] **Step 1: Write failing test**

Create `/Users/llam/dev/araguaney_front/components/layout/sidebar-logo.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SidebarLogo } from './sidebar-logo';

describe('<SidebarLogo />', () => {
  it('renders the brand name and subtitle', () => {
    render(<SidebarLogo />);
    expect(screen.getByText('Araguaney')).toBeInTheDocument();
    expect(screen.getByText('Certificados bursátiles')).toBeInTheDocument();
  });

  it('renders the "A" mark', () => {
    render(<SidebarLogo />);
    expect(screen.getByText('A', { selector: 'div' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/layout/sidebar-logo.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement `<SidebarLogo>`**

Create `/Users/llam/dev/araguaney_front/components/layout/sidebar-logo.tsx`:

```tsx
export function SidebarLogo() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <div className="bg-yellow text-side flex h-7 w-7 items-center justify-center rounded-[7px] text-base font-bold tracking-[-0.5px]">
        A
      </div>
      <div className="leading-[1.15]">
        <div className="text-xs font-semibold text-white">Araguaney</div>
        <div className="text-[10px] text-white/45">Certificados bursátiles</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Confirm tests pass**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/layout/sidebar-logo.test.tsx
```

Expected: 2 tests green.

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/layout/sidebar-logo.tsx components/layout/sidebar-logo.test.tsx
git commit -m "$(cat <<'EOF'
feat(layout): SidebarLogo (yellow "A" + brand text)

28x28 yellow square with "A" + "Araguaney" / "Certificados bursátiles".
Pixel-perfect copy of the Claude Design mockup.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `<SidebarUser>`

**Why:** Footer of the sidebar. Computes initials, translates role to Spanish.

**Files:**
- Create: `components/layout/sidebar-user.tsx`
- Create: `components/layout/sidebar-user.test.tsx`

- [ ] **Step 1: Write failing test**

Create `/Users/llam/dev/araguaney_front/components/layout/sidebar-user.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SidebarUser } from './sidebar-user';
import type { MeUser } from '@/lib/api/me';

const mkUser = (overrides: Partial<MeUser> = {}): MeUser => ({
  id: 'u-1',
  email: 'maria@cashea.app',
  full_name: 'María Rodríguez',
  role: 'operator',
  is_active: true,
  ...overrides,
});

describe('<SidebarUser />', () => {
  it('renders the full name and Spanish role label', () => {
    render(<SidebarUser user={mkUser()} />);
    expect(screen.getByText('María Rodríguez')).toBeInTheDocument();
    expect(screen.getByText('Tesorería')).toBeInTheDocument();
  });

  it('computes "MR" initials from "María Rodríguez"', () => {
    render(<SidebarUser user={mkUser()} />);
    expect(screen.getByText('MR')).toBeInTheDocument();
  });

  it('computes "J" initial when only one name part', () => {
    render(<SidebarUser user={mkUser({ full_name: 'Juan' })} />);
    expect(screen.getByText('J')).toBeInTheDocument();
  });

  it('uppercases initials regardless of input case', () => {
    render(<SidebarUser user={mkUser({ full_name: 'maría rodríguez' })} />);
    expect(screen.getByText('MR')).toBeInTheDocument();
  });

  it('renders "Administración" for admin role', () => {
    render(<SidebarUser user={mkUser({ role: 'admin' })} />);
    expect(screen.getByText('Administración')).toBeInTheDocument();
  });

  it('renders "Auditoría" for auditor role', () => {
    render(<SidebarUser user={mkUser({ role: 'auditor' })} />);
    expect(screen.getByText('Auditoría')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/layout/sidebar-user.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement `<SidebarUser>`**

Create `/Users/llam/dev/araguaney_front/components/layout/sidebar-user.tsx`:

```tsx
import { cn } from '@/lib/utils';
import type { MeUser } from '@/lib/api/me';

const ROLE_LABELS: Record<MeUser['role'], string> = {
  operator: 'Tesorería',
  admin: 'Administración',
  auditor: 'Auditoría',
};

function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}

interface Props {
  user: MeUser;
  className?: string;
}

export function SidebarUser({ user, className }: Props) {
  return (
    <div className={cn('flex items-center gap-2.5 px-2', className)}>
      <div className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-white/10 text-[11px] font-medium text-white">
        {initials(user.full_name)}
      </div>
      <div className="leading-[1.2]">
        <div className="text-xs font-medium text-white">{user.full_name}</div>
        <div className="text-[10px] text-white/50">{ROLE_LABELS[user.role]}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Confirm tests pass**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/layout/sidebar-user.test.tsx
```

Expected: 6 tests green.

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/layout/sidebar-user.tsx components/layout/sidebar-user.test.tsx
git commit -m "$(cat <<'EOF'
feat(layout): SidebarUser (avatar initials + name + role label)

30x30 circular avatar (initials from full_name) + name + Spanish
role label (Tesorería | Administración | Auditoría).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `<SidebarNavItem>`

**Why:** The clickable item in the sidebar. Active state visually critical (yellow bar).

**Files:**
- Create: `components/layout/sidebar-nav-item.tsx`
- Create: `components/layout/sidebar-nav-item.test.tsx`

- [ ] **Step 1: Write failing test**

Create `/Users/llam/dev/araguaney_front/components/layout/sidebar-nav-item.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SidebarNavItem } from './sidebar-nav-item';

describe('<SidebarNavItem />', () => {
  it('renders the label inside a link with the correct href', () => {
    render(<SidebarNavItem label="Certificados" href="/certificates" active={false} />);
    const link = screen.getByRole('link', { name: 'Certificados' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/certificates');
  });

  it('renders an active-state yellow bar when active=true', () => {
    const { container } = render(
      <SidebarNavItem label="Certificados" href="/certificates" active={true} />,
    );
    const bar = container.querySelector('span.bg-yellow');
    expect(bar).not.toBeNull();
  });

  it('does NOT render the yellow bar when active=false', () => {
    const { container } = render(
      <SidebarNavItem label="Certificados" href="/certificates" active={false} />,
    );
    const bar = container.querySelector('span.bg-yellow');
    expect(bar).toBeNull();
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/layout/sidebar-nav-item.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement `<SidebarNavItem>`**

Create `/Users/llam/dev/araguaney_front/components/layout/sidebar-nav-item.tsx`:

```tsx
import Link from 'next/link';
import { cn } from '@/lib/utils';

interface Props {
  label: string;
  href: string;
  active: boolean;
}

export function SidebarNavItem({ label, href, active }: Props) {
  return (
    <Link
      href={href}
      className={cn(
        'relative mb-px flex items-center gap-2.5 rounded-[7px] px-3 py-[9px] text-[13px] transition-colors',
        active
          ? 'bg-side-active text-white'
          : 'text-side-text hover:bg-side-hover hover:text-white',
      )}
    >
      {active && (
        <span className="bg-yellow absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-sm" />
      )}
      <span className="h-[5px] w-[5px] shrink-0 rounded-full bg-white/40" />
      <span className="flex-1">{label}</span>
    </Link>
  );
}
```

- [ ] **Step 4: Confirm tests pass**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/layout/sidebar-nav-item.test.tsx
```

Expected: 3 tests green.

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/layout/sidebar-nav-item.tsx components/layout/sidebar-nav-item.test.tsx
git commit -m "$(cat <<'EOF'
feat(layout): SidebarNavItem with active-state yellow bar

Next.js Link with two states:
- active=true  → yellow 2px left bar + bg-side-active + text white
- active=false → text 70% white + hover bg-side-hover

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `<SidebarNavSection>`

**Why:** Groups items under a section title and handles role-based item filtering.

**Files:**
- Create: `components/layout/sidebar-nav-section.tsx`
- Create: `components/layout/sidebar-nav-section.test.tsx`

- [ ] **Step 1: Write failing test**

Create `/Users/llam/dev/araguaney_front/components/layout/sidebar-nav-section.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SidebarNavSection } from './sidebar-nav-section';
import type { NavSection } from '@/lib/nav/nav-config';

const sectionAllItems: NavSection = {
  title: 'Operación',
  allowedRoles: ['operator', 'admin', 'auditor'],
  items: [
    { key: 'cycle', label: 'Panel del ciclo', href: '/cycle' },
    { key: 'certificates', label: 'Certificados', href: '/certificates' },
  ],
};

const sectionAdminOnly: NavSection = {
  title: 'Sistema',
  allowedRoles: ['admin', 'auditor'],
  items: [
    { key: 'users', label: 'Usuarios', href: '/users', allowedRoles: ['admin'] },
  ],
};

describe('<SidebarNavSection />', () => {
  it('renders the section title in uppercase letter-spaced text', () => {
    render(<SidebarNavSection section={sectionAllItems} pathname="/cycle" role="admin" />);
    expect(screen.getByText('Operación')).toBeInTheDocument();
  });

  it('renders all items when role is allowed for each', () => {
    render(<SidebarNavSection section={sectionAllItems} pathname="/cycle" role="admin" />);
    expect(screen.getByText('Panel del ciclo')).toBeInTheDocument();
    expect(screen.getByText('Certificados')).toBeInTheDocument();
  });

  it('hides items the role is not allowed to see', () => {
    render(<SidebarNavSection section={sectionAdminOnly} pathname="/cycle" role="auditor" />);
    expect(screen.queryByText('Usuarios')).toBeNull();
  });

  it('returns null when no items remain after filtering', () => {
    const { container } = render(
      <SidebarNavSection section={sectionAdminOnly} pathname="/cycle" role="auditor" />,
    );
    // Section title is also gone since the whole section returns null
    expect(container.firstChild).toBeNull();
  });

  it('marks the item active when pathname matches its href', () => {
    const { container } = render(
      <SidebarNavSection section={sectionAllItems} pathname="/certificates" role="admin" />,
    );
    const links = container.querySelectorAll('a');
    const cert = Array.from(links).find((l) => l.getAttribute('href') === '/certificates');
    expect(cert?.querySelector('span.bg-yellow')).not.toBeNull();
  });

  it('marks the item active when pathname is a sub-route', () => {
    const { container } = render(
      <SidebarNavSection section={sectionAllItems} pathname="/certificates/cert-001" role="admin" />,
    );
    const links = container.querySelectorAll('a');
    const cert = Array.from(links).find((l) => l.getAttribute('href') === '/certificates');
    expect(cert?.querySelector('span.bg-yellow')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/layout/sidebar-nav-section.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement `<SidebarNavSection>`**

Create `/Users/llam/dev/araguaney_front/components/layout/sidebar-nav-section.tsx`:

```tsx
import type { MeUser } from '@/lib/api/me';
import type { NavSection } from '@/lib/nav/nav-config';
import { SidebarNavItem } from './sidebar-nav-item';

interface Props {
  section: NavSection;
  pathname: string;
  role: MeUser['role'];
}

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/');
}

export function SidebarNavSection({ section, pathname, role }: Props) {
  const items = section.items.filter(
    (item) => !item.allowedRoles || item.allowedRoles.includes(role),
  );
  if (items.length === 0) return null;

  return (
    <div className="mb-[18px]">
      <div className="mb-1.5 px-3 text-[10px] font-medium tracking-[0.7px] text-white/35 uppercase">
        {section.title}
      </div>
      <div>
        {items.map((item) => (
          <SidebarNavItem
            key={item.key}
            label={item.label}
            href={item.href}
            active={isActive(pathname, item.href)}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Confirm tests pass**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/layout/sidebar-nav-section.test.tsx
```

Expected: 6 tests green.

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/layout/sidebar-nav-section.tsx components/layout/sidebar-nav-section.test.tsx
git commit -m "$(cat <<'EOF'
feat(layout): SidebarNavSection with per-item role filtering

Filters items by item.allowedRoles. Returns null when nothing visible
(hides the entire section title). Active state uses startsWith for
sub-route matching (so /certificates/{id} keeps Certificates highlighted).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `<SidebarNav>`

**Why:** Top-level nav container. Reads `usePathname` (client-only) and filters sections by role. The only client component in the layout.

**Files:**
- Create: `components/layout/sidebar-nav.tsx`
- Create: `components/layout/sidebar-nav.test.tsx`

- [ ] **Step 1: Write failing test**

Create `/Users/llam/dev/araguaney_front/components/layout/sidebar-nav.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SidebarNav } from './sidebar-nav';

vi.mock('next/navigation', () => ({
  usePathname: () => '/cycle',
}));

describe('<SidebarNav />', () => {
  it('admin sees all 9 items across 3 sections', () => {
    render(<SidebarNav role="admin" />);
    // 3 section headings
    expect(screen.getByText('Operación')).toBeInTheDocument();
    expect(screen.getByText('Datos')).toBeInTheDocument();
    expect(screen.getByText('Sistema')).toBeInTheDocument();
    // Spot-check 9 items
    const allLabels = [
      'Panel del ciclo', 'Certificados', 'Stock de órdenes', 'Inversores',
      'Lotes', 'Comercios',
      'Auditoría', 'Trazabilidad', 'Usuarios',
    ];
    for (const label of allLabels) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('auditor sees 8 items (no Usuarios) in 3 sections', () => {
    render(<SidebarNav role="auditor" />);
    expect(screen.getByText('Sistema')).toBeInTheDocument();
    expect(screen.getByText('Auditoría')).toBeInTheDocument();
    expect(screen.queryByText('Usuarios')).toBeNull();
  });

  it('operator sees 6 items in 2 sections (no Sistema)', () => {
    render(<SidebarNav role="operator" />);
    expect(screen.getByText('Operación')).toBeInTheDocument();
    expect(screen.getByText('Datos')).toBeInTheDocument();
    expect(screen.queryByText('Sistema')).toBeNull();
    expect(screen.queryByText('Auditoría')).toBeNull();
    expect(screen.queryByText('Usuarios')).toBeNull();
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/layout/sidebar-nav.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement `<SidebarNav>`**

Create `/Users/llam/dev/araguaney_front/components/layout/sidebar-nav.tsx`:

```tsx
'use client';

import { usePathname } from 'next/navigation';
import type { MeUser } from '@/lib/api/me';
import { NAV_SECTIONS } from '@/lib/nav/nav-config';
import { SidebarNavSection } from './sidebar-nav-section';

interface Props {
  role: MeUser['role'];
  className?: string;
}

export function SidebarNav({ role, className }: Props) {
  const pathname = usePathname();
  const visible = NAV_SECTIONS.filter((s) => s.allowedRoles.includes(role));

  return (
    <nav className={className}>
      {visible.map((section) => (
        <SidebarNavSection
          key={section.title}
          section={section}
          pathname={pathname}
          role={role}
        />
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: Confirm tests pass**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/layout/sidebar-nav.test.tsx
```

Expected: 3 tests green.

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/layout/sidebar-nav.tsx components/layout/sidebar-nav.test.tsx
git commit -m "$(cat <<'EOF'
feat(layout): SidebarNav (client) with usePathname + role filtering

Top-level container that reads the current path via usePathname()
and filters NAV_SECTIONS by user role. The only Client Component in
the layout — everything below it is RSC-friendly.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: `<Sidebar>` composition + logout

**Why:** Pulls all the sidebar pieces together and wires the existing logoutAction.

**Files:**
- Create: `components/layout/sidebar.tsx`
- Create: `components/layout/sidebar.test.tsx`

- [ ] **Step 1: Write failing test**

Create `/Users/llam/dev/araguaney_front/components/layout/sidebar.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sidebar } from './sidebar';
import type { MeUser } from '@/lib/api/me';

vi.mock('next/navigation', () => ({
  usePathname: () => '/cycle',
}));

const user: MeUser = {
  id: 'u-1',
  email: 'maria@cashea.app',
  full_name: 'María Rodríguez',
  role: 'admin',
  is_active: true,
};

describe('<Sidebar />', () => {
  it('renders logo, nav, user, and a logout button', () => {
    render(<Sidebar user={user} />);
    expect(screen.getByText('Araguaney')).toBeInTheDocument();
    expect(screen.getByText('Panel del ciclo')).toBeInTheDocument();
    expect(screen.getByText('María Rodríguez')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cerrar sesión/i })).toBeInTheDocument();
  });

  it('logout button is inside a form posting to the logoutAction', () => {
    const { container } = render(<Sidebar user={user} />);
    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    // Form has a submit button with the expected label
    const button = form?.querySelector('button[type="submit"]');
    expect(button?.textContent).toMatch(/cerrar sesión/i);
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/layout/sidebar.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement `<Sidebar>`**

Create `/Users/llam/dev/araguaney_front/components/layout/sidebar.tsx`:

```tsx
import { logoutAction } from '@/app/(app)/logout/actions';
import type { MeUser } from '@/lib/api/me';
import { SidebarLogo } from './sidebar-logo';
import { SidebarNav } from './sidebar-nav';
import { SidebarUser } from './sidebar-user';

interface Props {
  user: MeUser;
}

export function Sidebar({ user }: Props) {
  return (
    <aside className="bg-side text-side-text sticky top-0 flex h-screen w-[220px] flex-col px-3 py-5">
      <div className="mb-6">
        <SidebarLogo />
      </div>

      <SidebarNav role={user.role} className="flex-1 overflow-y-auto" />

      <div className="mt-2 border-t border-white/[0.08] pt-3.5">
        <SidebarUser user={user} />
        <form action={logoutAction}>
          <button
            type="submit"
            className="hover:bg-side-hover mt-2 w-full rounded-md px-2 py-1.5 text-left text-[11px] text-white/45 transition-colors hover:text-white"
          >
            Cerrar sesión
          </button>
        </form>
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Confirm tests pass**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/layout/sidebar.test.tsx
```

Expected: 2 tests green.

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/layout/sidebar.tsx components/layout/sidebar.test.tsx
git commit -m "$(cat <<'EOF'
feat(layout): Sidebar composition (logo + nav + user + logout)

Wires the existing logoutAction (Slice 0) into a discrete button
under the user block. 220px wide, sticky, full-height, dark.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: `<AppShell>` + integration test

**Why:** The grid container that combines sidebar + main. The integration test verifies the whole layout renders correctly with a sample user + child page.

**Files:**
- Create: `components/layout/app-shell.tsx`
- Create: `components/layout/app-shell.test.tsx`

- [ ] **Step 1: Write failing test**

Create `/Users/llam/dev/araguaney_front/components/layout/app-shell.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppShell } from './app-shell';
import type { MeUser } from '@/lib/api/me';

vi.mock('next/navigation', () => ({
  usePathname: () => '/cycle',
}));

const adminUser: MeUser = {
  id: 'u-1',
  email: 'admin@cashea.app',
  full_name: 'Ana Admin',
  role: 'admin',
  is_active: true,
};

describe('<AppShell />', () => {
  it('renders sidebar + main with children for admin user', () => {
    render(
      <AppShell user={adminUser}>
        <div data-testid="page">Cycle page content</div>
      </AppShell>,
    );
    // Sidebar present
    expect(screen.getByText('Araguaney')).toBeInTheDocument();
    expect(screen.getByText('Panel del ciclo')).toBeInTheDocument();
    expect(screen.getByText('Sistema')).toBeInTheDocument();
    // Main content present
    expect(screen.getByTestId('page')).toBeInTheDocument();
  });

  it('hides Sistema for operator role', () => {
    render(
      <AppShell user={{ ...adminUser, role: 'operator' }}>
        <div>X</div>
      </AppShell>,
    );
    expect(screen.queryByText('Sistema')).toBeNull();
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/layout/app-shell.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement `<AppShell>`**

Create `/Users/llam/dev/araguaney_front/components/layout/app-shell.tsx`:

```tsx
import type { MeUser } from '@/lib/api/me';
import { Sidebar } from './sidebar';

interface Props {
  user: MeUser;
  children: React.ReactNode;
}

export function AppShell({ user, children }: Props) {
  return (
    <div className="grid min-h-screen grid-cols-[220px_1fr]">
      <Sidebar user={user} />
      <main className="flex min-w-0 flex-col">{children}</main>
    </div>
  );
}
```

- [ ] **Step 4: Confirm tests pass**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/layout/app-shell.test.tsx
```

Expected: 2 tests green.

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/layout/app-shell.tsx components/layout/app-shell.test.tsx
git commit -m "$(cat <<'EOF'
feat(layout): AppShell grid (sidebar 220px | main flex)

min-w-0 on main is critical: prevents wide tables (Slice 2+) from
pushing the grid and breaking the sidebar's fixed width.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Wire AppShell into `(app)/layout.tsx` + redirect from `/`

**Why:** Gives every authenticated route the new shell. Replaces the Slice 0 placeholder home with a redirect to `/cycle`.

**Files:**
- Modify: `app/(app)/layout.tsx`
- Modify: `app/(app)/page.tsx`

- [ ] **Step 1: Replace `app/(app)/layout.tsx`**

Read the current file first to confirm shape, then write the new version.

```bash
cat /Users/llam/dev/araguaney_front/app/\(app\)/layout.tsx
```

Replace its contents with:

```tsx
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { getCurrentUser } from '@/lib/auth/session';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/clear');
  return <AppShell user={user}>{children}</AppShell>;
}
```

- [ ] **Step 2: Replace `app/(app)/page.tsx`**

Replace its contents with:

```tsx
import { redirect } from 'next/navigation';

export default function HomePage() {
  redirect('/cycle');
}
```

This makes `/` always redirect to `/cycle` for authenticated users (`(app)` group already gates auth).

- [ ] **Step 3: Verify typecheck and existing tests still pass**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add 'app/(app)/layout.tsx' 'app/(app)/page.tsx'
git commit -m "$(cat <<'EOF'
feat(app): wrap (app) routes in AppShell + redirect / → /cycle

Layout adds AppShell around children (auth still verified by getCurrentUser).
Home page (/) becomes a redirect to /cycle (the new landing route).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Create the 9 placeholder pages

**Why:** Sidebar items navigate to real routes; each renders the same `<PageHeader>` + `<ComingSoon>` pattern.

**Files:**
- Create: `app/(app)/cycle/page.tsx`
- Create: `app/(app)/certificates/page.tsx`
- Create: `app/(app)/stock/page.tsx`
- Create: `app/(app)/investors/page.tsx`
- Create: `app/(app)/batches/page.tsx`
- Create: `app/(app)/merchants/page.tsx`
- Create: `app/(app)/audit/page.tsx`
- Create: `app/(app)/traceability/page.tsx`
- Create: `app/(app)/users/page.tsx`

- [ ] **Step 1: Create each page**

Each file is identical structure with different `breadcrumb` and `title`. Use the Write tool to create each.

The shared shell of every page:

```tsx
import { ComingSoon } from '@/components/layout/coming-soon';
import { PageHeader } from '@/components/layout/page-header';

export default function <NAME>Page() {
  return (
    <div className="mx-auto w-full max-w-[1440px] px-9 py-7">
      <PageHeader breadcrumb={{ section: '<SECTION>', current: '<CURRENT>' }} title="<TITLE>" />
      <ComingSoon />
    </div>
  );
}
```

Per-file values:

| File | NAME | SECTION | CURRENT and TITLE |
|---|---|---|---|
| `app/(app)/cycle/page.tsx` | `Cycle` | `Operación` | `Panel del ciclo` |
| `app/(app)/certificates/page.tsx` | `Certificates` | `Operación` | `Certificados` |
| `app/(app)/stock/page.tsx` | `Stock` | `Operación` | `Stock de órdenes` |
| `app/(app)/investors/page.tsx` | `Investors` | `Operación` | `Inversores` |
| `app/(app)/batches/page.tsx` | `Batches` | `Datos` | `Lotes` |
| `app/(app)/merchants/page.tsx` | `Merchants` | `Datos` | `Comercios` |
| `app/(app)/audit/page.tsx` | `Audit` | `Sistema` | `Auditoría` |
| `app/(app)/traceability/page.tsx` | `Traceability` | `Sistema` | `Trazabilidad` |
| `app/(app)/users/page.tsx` | `Users` | `Sistema` | `Usuarios` |

Example concrete file (`app/(app)/cycle/page.tsx`):

```tsx
import { ComingSoon } from '@/components/layout/coming-soon';
import { PageHeader } from '@/components/layout/page-header';

export default function CyclePage() {
  return (
    <div className="mx-auto w-full max-w-[1440px] px-9 py-7">
      <PageHeader
        breadcrumb={{ section: 'Operación', current: 'Panel del ciclo' }}
        title="Panel del ciclo"
      />
      <ComingSoon />
    </div>
  );
}
```

Apply the same pattern for the other 8 files, substituting NAME / SECTION / CURRENT / TITLE per the table above.

- [ ] **Step 2: Verify typecheck + lint + tests + format pass**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

Expected: all pass. If format fails, run `pnpm format`.

- [ ] **Step 3: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add 'app/(app)/'
git commit -m "$(cat <<'EOF'
feat(app): 9 stub pages for sidebar items

Each renders PageHeader + ComingSoon. Routes:
- /cycle, /certificates, /stock, /investors (Operación)
- /batches, /merchants (Datos)
- /audit, /traceability, /users (Sistema)

Real content will land in subsequent slices.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Local smoke + visual sanity check

**Why:** Confirm the layout renders correctly end-to-end before pushing. Catch any visual regression vs the mockup.

**Files:** none (verification only).

**Pre-req:** `.env.local` from Slice 0 already has `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` so login works.

- [ ] **Step 1: Boot dev server**

```bash
cd /Users/llam/dev/araguaney_front
lsof -ti:3000 | xargs kill -9 2>/dev/null
pnpm dev > /tmp/front-task14.log 2>&1 &
PID=$!
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if grep -q "Ready in" /tmp/front-task14.log 2>/dev/null; then echo "ready in ${i}s"; break; fi
  sleep 1
done
```

- [ ] **Step 2: Verify route gating + redirects**

```bash
# Without cookie → / should still redirect to /login
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3000/
# Expected: 307 to /login

# /cycle without cookie should also bounce to /login
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3000/cycle
# Expected: 307 to /login

# /audit (admin/auditor only) — middleware doesn't gate by role; cookie absence redirects
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3000/audit
# Expected: 307 to /login
```

- [ ] **Step 3: Verify rendered content includes layout primitives**

Visit http://localhost:3000/login in a browser, log in with the test operator credentials, then navigate to /cycle. You should see:

- Dark sidebar on the left, 220px wide
- Yellow "A" logo + "Araguaney" / "Certificados bursátiles"
- 3 sections (admin user) or 2 sections (operator user)
- "Panel del ciclo" item highlighted with yellow left bar + white text
- Avatar circle with initials + name + role at bottom
- "Cerrar sesión" link below user info
- Main area: breadcrumb "Operación · **Panel del ciclo**" + h1 "Panel del ciclo" + "Próximamente" placeholder centered below

Click around all 9 sidebar items. Each click changes the URL + the active item's yellow bar moves. The main page content updates with the right breadcrumb + title.

Click "Cerrar sesión" → redirects to /login, cookie cleared.

- [ ] **Step 4: Stop dev server**

```bash
kill $PID; wait $PID 2>/dev/null
```

- [ ] **Step 5: No commit needed**

This task is verification only. If something visual is off, adjust the offending component and commit a fix before proceeding.

---

## Task 15: Push branch + open PR

**Files:** none (git + GitHub).

- [ ] **Step 1: Push the branch**

```bash
cd /Users/llam/dev/araguaney_front
git push -u origin feat/slice-1-app-shell
```

Expected: success (no branch protection prevents push of non-main branches).

- [ ] **Step 2: Open PR**

Try via gh CLI first:

```bash
gh pr create --title "feat: Slice 1 — app shell (sidebar + topbar + 9 stub routes)" --body "$(cat <<'EOF'
## Summary

Builds the authenticated app shell of araguaney_front: dark sidebar (220px) with logo + role-filtered nav + user footer, topbar pattern with breadcrumb + h1 + actions slot, and 9 stub routes for the sidebar items.

Pixel-perfect replication of the Claude Design mockup (extracted in `araguaney_front/design/_extracted/`).

## What's new

- Design tokens via Tailwind v4 `@theme` (colors, fonts, borders) — shadcn base-nova auto-themed via CSS var override
- Google Fonts: Poppins (UI) + JetBrains Mono (numbers, used Slice 2+)
- Components in `components/layout/`:
  - AppShell (grid)
  - Sidebar + SidebarLogo + SidebarNav + SidebarNavSection + SidebarNavItem + SidebarUser
  - PageHeader (breadcrumb + h1 + actions)
  - ComingSoon (placeholder)
- `lib/nav/nav-config.ts` — single source of truth for sidebar items + role rules (admin sees 9, auditor 8, operator 6)
- 9 placeholder pages under `app/(app)/`: cycle, certificates, stock, investors, batches, merchants, audit, traceability, users
- `/` redirects to `/cycle` for authenticated users

## Test Plan

- [x] `pnpm typecheck && pnpm lint:check && pnpm format:check && pnpm test && pnpm build` — all clean
- [x] Local smoke: login → /cycle renders with sidebar + breadcrumb + ComingSoon
- [x] Click each of the 9 sidebar items → URL changes + active state moves
- [x] Logout from sidebar works
- [ ] Vercel preview deploy renders the new layout with no console errors
- [ ] Visual sanity vs mockup screenshot

## Notes

- Mobile responsive deferred (3 desktop operators).
- Direct-URL access to role-restricted routes (e.g. operator visiting /audit) is **not yet blocked**; route is reachable but only renders the placeholder. Server-side guard added in Slice 2+ when those pages have real content.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

If gh fails with "must be a collaborator" (the auth account is `ArmandoGois` but the repo is in `armandogois-lab`), open the PR manually in the browser at:

`https://github.com/armandogois-lab/araguaney_front/pull/new/feat/slice-1-app-shell`

- [ ] **Step 3: Wait for CI**

Watch the PR's checks tab or run:

```bash
until gh run list --repo armandogois-lab/araguaney_front --limit 1 --json status -q '.[0].status' | grep -q completed; do sleep 5; done
gh run list --repo armandogois-lab/araguaney_front --limit 1
```

Expected: CI green.

If CI fails, capture the error output, fix locally, push to the same branch (PR auto-updates), and re-watch.

---

## Self-Review

**Spec coverage:**

- ✅ Design tokens via `@theme`: Task 1
- ✅ Google Fonts: Task 1
- ✅ Body baseline (13px, Poppins, color-bg): Task 1
- ✅ shadcn re-theming: Task 1 (`:root` overrides)
- ✅ AppShell + grid layout: Task 11
- ✅ Sidebar (220px, dark, sticky): Task 10
- ✅ SidebarLogo (yellow A + Araguaney): Task 5
- ✅ SidebarNav with usePathname + role filtering: Task 9
- ✅ SidebarNavSection with item-level role filtering: Task 8
- ✅ SidebarNavItem with active yellow bar: Task 7
- ✅ SidebarUser with initials + role labels: Task 6
- ✅ PageHeader: Task 4
- ✅ ComingSoon: Task 3
- ✅ nav-config: Task 2
- ✅ 9 placeholder pages: Task 13
- ✅ Logout in sidebar: Task 10
- ✅ `/` redirects to `/cycle`: Task 12
- ✅ All criterios de éxito have a test or smoke step

**Placeholder scan:** No `TODO`/`TBD`/`fill in` markers in tasks. Templates like `<NAME>`, `<SECTION>`, `<CURRENT>`, `<TITLE>` in Task 13 are explicitly bound to a table — they are placeholders for the implementer to substitute, not unfilled spec gaps.

**Type consistency:**
- `MeUser['role']` type used consistently in nav-config, SidebarUser, SidebarNav, AppShell ✓
- `NavSection`/`NavItem` interfaces exported from nav-config and consumed only by SidebarNav* components ✓
- `PageHeader` props (`breadcrumb`, `title`, `actions`) match across Task 4 (def) and Task 13 (usage) ✓
- `Sidebar` takes `user: MeUser` (Task 10), `AppShell` takes `user: MeUser` (Task 11), `(app)/layout.tsx` passes the result of `getCurrentUser()` (which returns `MeUser | null`, narrowed by the redirect check) ✓
- `logoutAction` from `@/app/(app)/logout/actions` reused (Task 10), unchanged from Slice 0 ✓

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-08-front-slice-1-app-shell.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, two-stage review (spec compliance + code quality) between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session with batch checkpoints.

**Which approach?**
