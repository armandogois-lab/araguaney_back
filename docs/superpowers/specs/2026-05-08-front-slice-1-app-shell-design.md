# Frontend Slice 1 — App Shell (Sidebar + Topbar + Stub Routes) Design Spec

**Fecha:** 2026-05-08
**Estado:** Aprobado, listo para implementation plan
**Repo afectado:** `araguaney_front` (Slice 0 ya desplegado)
**Repo dependiente:** `araguaney_back` desplegado en Railway con auth funcionando

---

## Goal

Construir el layout autenticado de Cashea CFB replicando pixel-perfect el diseño de Claude Design (extraído en `design/_extracted/`): sidebar oscuro fijo con secciones por rol, topbar con breadcrumb + título + slot de acciones, y stubs navegables para cada una de las 9 secciones del menú. Sin datos reales — el contenido por sección se cubre en slices subsiguientes.

## Non-Goals (YAGNI)

- Datos reales (KPIs, listas, tablas) en cualquier pantalla — todas las páginas muestran un placeholder `<ComingSoon>`. Cada slice subsiguiente puebla su pantalla.
- Mobile responsive — el sidebar 220px fijo se rompe en viewports angostos. 3 operadores en escritorio, agregamos drawer cuando alguien lo pida.
- Pills, DataTable, Modal, otros componentes complejos del diseño — se construyen on-demand en slices futuros.
- Theme toggle / dark mode.
- Sidebar collapse / pin.
- Animaciones de transición entre rutas (Next.js default + nuestras transiciones de hover bastan).
- Fetch de datos en `(app)/layout.tsx` más allá de `getCurrentUser()` que ya existe.
- Refactor de los components de Slice 0 (`<LoginForm>`, `<LogoutButton>`) — quedan como están; el botón de logout en el sidebar es **adicional**, no reemplaza al de la home (que igual va a ser eliminado al hacer redirect a `/cycle`).

## Decisiones cerradas (Q&A brainstorm)

| Q | Decisión | Razón |
|---|---|---|
| Q1 | Tokens via `@theme` de Tailwind v4 | Una sola fuente de verdad para Tailwind utilities + shadcn re-theming + CSS crudo |
| Q2 | Stubs por cada item del sidebar (9 routes) | Active state funciona end-to-end; sidebar parece "vivo" en demos; futuros slices ya tienen el archivo donde meter contenido |
| Q3 | Desktop-only (sin mobile) | YAGNI — 3 operadores en escritorio. Agregamos drawer cuando alguien lo pida. |

## Preferencia explícita del usuario

> "Me gustaría componentizar todo, y que quede todo lo más modular posible."

Aplicación: cada pieza del sidebar es un componente con una sola responsabilidad. `<Sidebar>` es composición — no contiene styling, lo delegan los hijos. La nav config vive en un solo archivo (`lib/nav/nav-config.ts`) como fuente única de verdad de items + roles.

## Referencia de diseño

Source: `design/_extracted/` (extraído del HTML bundleado de Claude Design via `gzip -d` + base64 decode).

Componentes reference relevantes:
- `addd0794-...js` → App root con view switching
- `d987f1bd-...js` → Sidebar component (220px, sections, NavItem con yellow bar)
- `1a7c6e34-...js` → Dashboard (patrón de breadcrumb + h1 + acciones)

CSS tokens y fuentes en `_template.html` (CSS variables `--side`, `--yellow`, `--text-3`, etc., fonts Poppins + JetBrains Mono).

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ app/(app)/layout.tsx (Server Component)                     │
│   - getCurrentUser() → MeUser | redirect('/auth/clear')     │
│   - <AppShell user={user}>{children}</AppShell>             │
│                                                             │
│   ┌───────────────────────────────────────────────────────┐ │
│   │ <AppShell> = grid 220px | flex 1                      │ │
│   │                                                       │ │
│   │  ┌──────────────┐  ┌──────────────────────────────┐  │ │
│   │  │ <Sidebar>    │  │ <main>                       │  │ │
│   │  │  Logo        │  │   {children}                 │  │ │
│   │  │  Nav         │  │   = page.tsx of current      │  │ │
│   │  │   Sec/Items  │  │     route                    │  │ │
│   │  │  User        │  │                              │  │ │
│   │  │  Logout btn  │  │   <PageHeader />             │  │ │
│   │  └──────────────┘  │   <ComingSoon /> (Slice 1)   │  │ │
│   │                    └──────────────────────────────┘  │ │
│   └───────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**Características:**

- **Server-first**: el layout y todos los page.tsx son Server Components. Solo `<SidebarNav>` (que necesita `usePathname()`) es Client Component.
- **Modular**: 9 componentes nuevos en `components/layout/`, cada uno <50 líneas, cada uno con una responsabilidad.
- **Role-driven**: la visibilidad del menú depende del `user.role`. La fuente única es `lib/nav/nav-config.ts`.
- **Token-driven**: todos los colores, fuentes y radii vienen de CSS variables en `globals.css → @theme`. Tailwind utilities (`bg-side`, `text-yellow`) los consumen directamente.

---

## File Structure

```
araguaney_front/
├─ app/
│  ├─ globals.css                       # MODIFICAR: agregar @theme con tokens del diseño + Google Fonts
│  ├─ (app)/
│  │  ├─ layout.tsx                     # MODIFICAR: envolver children en <AppShell>
│  │  ├─ page.tsx                       # MODIFICAR: redirect('/cycle')
│  │  ├─ cycle/page.tsx                 # CREAR (placeholder)
│  │  ├─ certificates/page.tsx          # CREAR
│  │  ├─ stock/page.tsx                 # CREAR
│  │  ├─ investors/page.tsx             # CREAR
│  │  ├─ batches/page.tsx               # CREAR
│  │  ├─ merchants/page.tsx             # CREAR
│  │  ├─ audit/page.tsx                 # CREAR
│  │  ├─ traceability/page.tsx          # CREAR
│  │  └─ users/page.tsx                 # CREAR
│
├─ components/
│  └─ layout/                           # NUEVO grupo
│     ├─ app-shell.tsx                  # grid + Sidebar + main
│     ├─ sidebar.tsx                    # composición (logo + nav + user + logout)
│     ├─ sidebar-logo.tsx               # 28x28 yellow A + "Araguaney" text
│     ├─ sidebar-nav.tsx                # client component, usePathname() + filter
│     ├─ sidebar-nav-section.tsx        # SECTION TITLE + items
│     ├─ sidebar-nav-item.tsx           # Link con dot + activeBar
│     ├─ sidebar-user.tsx               # MR avatar + name + role traducido
│     ├─ page-header.tsx                # breadcrumb + h1 + slot acciones
│     └─ coming-soon.tsx                # placeholder centrado
│
├─ lib/
│  └─ nav/
│     └─ nav-config.ts                  # NUEVO: NAV_SECTIONS array
│
└─ test/
   └─ integration/
      └─ app-shell.test.tsx             # NUEVO: render shell + page, verificar visibility
```

**Tres capas claras** (matching Slice 0 architecture):

1. **`app/`** — solo rutas. Pages ~10 líneas cada una, delegan a `<PageHeader>` + `<ComingSoon>`.
2. **`components/layout/`** — UI puro. Cada archivo <50 líneas. `<Sidebar>` es composición; lógica de active state vive en `<SidebarNavSection>` y `<SidebarNavItem>`.
3. **`lib/nav/`** — config sin JSX. Tipos exportados (`NavItem`, `NavSection`) + array constante.

---

## Design Tokens

### Tokens en `globals.css` via `@theme`

```css
@import "tailwindcss";

@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

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
  --color-border: rgba(0,0,0,0.08);
  --color-border-strong: rgba(0,0,0,0.18);
  --color-border-soft: rgba(0,0,0,0.04);

  /* Sidebar (dark) */
  --color-side: #0A0A0A;
  --color-side-text: rgba(254,254,254,0.7);
  --color-side-active: rgba(254,254,254,0.08);
  --color-side-hover: rgba(254,254,254,0.05);

  /* Accent */
  --color-yellow: #FDFA3D;

  /* Status pills (futuro Slice 2+) */
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

/* Body baseline */
html, body {
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
}

/* Tabular nums helper para tablas (Slice 2+) */
.num { font-variant-numeric: tabular-nums; }
```

### Override de tokens shadcn base-nova

shadcn base-nova define sus propios tokens (`--background`, `--primary`, etc.). Los re-apuntamos a los nuestros:

```css
:root {
  --background: var(--color-bg);
  --foreground: var(--color-text);
  --card: var(--color-card);
  --card-foreground: var(--color-text);
  --primary: var(--color-side);
  --primary-foreground: #FEFEFE;
  --secondary: var(--color-card);
  --secondary-foreground: var(--color-text);
  --border: var(--color-border-strong);
  --input: var(--color-border-strong);
  --muted: var(--color-hover);
  --muted-foreground: var(--color-text-3);
  --ring: var(--color-side);
  --radius: 0.5rem;
}
```

Resultado: cualquier `<Button>`, `<Card>`, `<Input>` shadcn matchea visual del diseño automáticamente.

### Clases compuestas del diseño (`.btn`, `.pill`, `.tbl`, `.card`)

NO se importan al CSS. Se reconstruyen como componentes React envolviendo shadcn cuando sean necesarias. Slice 1 NO necesita ninguna.

---

## Components

### `<AppShell user={user}>`

Layout container. Grid 220px sidebar | flex 1 main. Server Component. ~15 líneas.

### `<Sidebar user={user}>`

Composición pura. ~25 líneas. Compone `<SidebarLogo>`, `<SidebarNav>`, `<SidebarUser>`, y un botón de logout. No contiene lógica.

### `<SidebarLogo>`

Logo amarillo 28x28 con "A" + texto "Araguaney" / "Certificados bursátiles". Sin props, sin estado. ~12 líneas.

### `<SidebarNav role={role}>`

Client Component (`'use client'`). Usa `usePathname()`. Lee `NAV_SECTIONS` y filtra por `role`. Renderiza `<SidebarNavSection>` por cada sección visible. ~30 líneas.

### `<SidebarNavSection section pathname role>`

Filtra items de la sección por `role`. Si quedan 0 items, retorna null (oculta la sección). Renderiza el título de sección + cada `<SidebarNavItem>`. ~25 líneas.

### `<SidebarNavItem label href active>`

`<Link>` de Next.js con styling exacto del diseño:
- Active=true: yellow bar 2px a la izquierda, texto blanco, `bg-side-active`
- Active=false: texto `side-text` (70% blanco), hover `bg-side-hover`
- Dot decorativo 5x5 a la izquierda

~20 líneas.

### `<SidebarUser user>`

Avatar circular 30x30 con iniciales (computadas de `full_name`) + nombre + rol traducido al español:
- `operator` → "Tesorería"
- `admin` → "Administración"
- `auditor` → "Auditoría"

~25 líneas.

### `<PageHeader breadcrumb title actions?>`

Patrón reusable para todas las pages. Breadcrumb (formato "Section · **Current**") + h1 (22px, font-semibold, tracking tight) + slot opcional de acciones a la derecha. ~20 líneas.

### `<ComingSoon message?>`

Placeholder centrado. Default message: "Esta sección estará disponible en próximos slices." Override por prop. ~12 líneas.

---

## Nav Config

### `lib/nav/nav-config.ts`

```ts
import type { MeUser } from '@/lib/api/me';

type Role = MeUser['role'];

export interface NavItem {
  key: string;
  label: string;
  href: string;
  /** Roles que pueden ver este item. Undefined = todos los autenticados. */
  allowedRoles?: readonly Role[];
}

export interface NavSection {
  title: string;
  /** Roles que pueden ver la sección. */
  allowedRoles: readonly Role[];
  items: readonly NavItem[];
}

const ALL_ROLES = ['operator', 'admin', 'auditor'] as const;

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    title: 'Operación',
    allowedRoles: ALL_ROLES,
    items: [
      { key: 'cycle',        label: 'Panel del ciclo',  href: '/cycle' },
      { key: 'certificates', label: 'Certificados',     href: '/certificates' },
      { key: 'stock',        label: 'Stock de órdenes', href: '/stock' },
      { key: 'investors',    label: 'Inversores',       href: '/investors' },
    ],
  },
  {
    title: 'Datos',
    allowedRoles: ALL_ROLES,
    items: [
      { key: 'batches',   label: 'Lotes',     href: '/batches' },
      { key: 'merchants', label: 'Comercios', href: '/merchants' },
    ],
  },
  {
    title: 'Sistema',
    allowedRoles: ['admin', 'auditor'],
    items: [
      { key: 'audit',        label: 'Auditoría',    href: '/audit' },
      { key: 'traceability', label: 'Trazabilidad', href: '/traceability' },
      { key: 'users',        label: 'Usuarios',     href: '/users', allowedRoles: ['admin'] },
    ],
  },
] as const;
```

### Reglas de visibilidad

| Rol | Operación | Datos | Sistema |
|---|---|---|---|
| `operator` | ✅ todos | ✅ todos | ❌ oculto |
| `auditor` | ✅ todos | ✅ todos | ✅ Auditoría + Trazabilidad (sin Usuarios) |
| `admin` | ✅ todos | ✅ todos | ✅ todos (incluye Usuarios) |

---

## Routing

| Path | Componente | Visibilidad |
|---|---|---|
| `/` | redirect → `/cycle` | autenticado |
| `/cycle` | placeholder | todos los roles |
| `/certificates` | placeholder | todos |
| `/stock` | placeholder | todos |
| `/investors` | placeholder | todos |
| `/batches` | placeholder | todos |
| `/merchants` | placeholder | todos |
| `/audit` | placeholder | admin + auditor |
| `/traceability` | placeholder | admin + auditor |
| `/users` | placeholder | admin |

**Nota sobre acceso por URL directo:** En Slice 1 NO bloqueamos el acceso por URL directo a rutas que el rol no debería ver. Si un `operator` escribe `/audit` en el browser, ve la página placeholder. Lo correcto en producción sería un guard server-side, pero como las páginas no tienen contenido sensible aún, lo defer a Slice 2+ cuando agregamos contenido real. Documentar como "future improvement" en el plan.

---

## Logout flow

El `<LogoutButton>` original (Slice 0) vivía en `app/(app)/page.tsx`. Como ahora `/` hace redirect a `/cycle`, ese botón se queda huérfano. El sidebar incluye un botón de logout discreto debajo de `<SidebarUser>`:

```tsx
// dentro de Sidebar.tsx
<form action={logoutAction}>
  <button type="submit" className="...">Cerrar sesión</button>
</form>
```

`logoutAction` es la misma Server Action que ya existe en `app/(app)/logout/actions.ts`. No se cambia.

---

## Testing Strategy

### Unit (Vitest + Testing Library)

| Test | Aserciones |
|---|---|
| `sidebar-logo.test.tsx` | Renders "Araguaney" + "Certificados bursátiles". |
| `sidebar-nav-item.test.tsx` | Active=true → yellow bar visible. Active=false → no bar. Link href correcto. |
| `sidebar-nav-section.test.tsx` | Filter items por allowedRoles. Si todos filtrados → null. |
| `sidebar-nav.test.tsx` | role='operator' → 6 items, 2 secciones. role='admin' → 9 items, 3 secciones. role='auditor' → 8 items, 3 secciones. |
| `sidebar-user.test.tsx` | "María Rodríguez" → "MR". "Juan" → "J". Role labels en español. |
| `page-header.test.tsx` | Breadcrumb formato. Acciones renderizan si pasadas. |
| `coming-soon.test.tsx` | Default + custom message. |
| `nav-config.test.ts` | Snapshot del filtrado por cada rol. |

### Integration

| Test | Aserciones |
|---|---|
| `app-shell.test.tsx` | Mount `<AppShell>` con un user mock + un page placeholder. Verifica sidebar visible, items correctos para el rol, active state, logout button presente. Mock `usePathname` para forzar ruta. |

### Smoke (post-deploy manual)

```bash
FRONT="https://araguaney-front.vercel.app"
for path in /cycle /certificates /stock /investors /batches /merchants /audit /traceability /users; do
  curl -sI "$FRONT$path" | head -2
done
# Sin cookie → todos 307 → /login
```

Visual end-to-end: login con browser, verificar que el sidebar renderiza, navegar entre items, verificar active state, logout.

---

## Criterios de éxito

- ✅ `pnpm dev` arranca sin warnings nuevos
- ✅ Login → aterriza en `/cycle` con sidebar visible
- ✅ Sidebar muestra logo "A" amarillo + texto "Araguaney" / "Certificados bursátiles"
- ✅ Sidebar muestra 3 secciones (admin/auditor) o 2 (operator)
- ✅ Click en cualquier item navega + active state cambia
- ✅ Active item: yellow left bar + texto blanco + bg semi-transparente
- ✅ Footer del sidebar: avatar de iniciales correctas + nombre + rol traducido
- ✅ Botón "Cerrar sesión" en sidebar dispara logout
- ✅ Cada página renderiza `<PageHeader>` + `<ComingSoon>`
- ✅ Pixel-fidelity vs el screenshot original (verificable a ojo)
- ✅ shadcn primitives (cuando se usen en futuros slices) heredan los nuevos tokens
- ✅ `pnpm typecheck && pnpm lint:check && pnpm test && pnpm build` 0 errores
- ✅ CI verde
- ✅ Vercel deploy verde + smoke tests post-deploy verdes

---

## Tech Stack (sin cambios respecto a Slice 0)

| Decisión | Valor |
|---|---|
| Framework | Next.js 16 + App Router |
| UI | shadcn/ui base-nova + Tailwind v4 + tokens custom |
| Fonts | Poppins (UI) + JetBrains Mono (números) via Google Fonts |
| State | TanStack Query (instalado, sin uso aún) |
| Auth | HttpOnly cookie + middleware + Server Actions (Slice 0) |
| Tests | Vitest + Testing Library |
| Linting | ESLint + Prettier |
| Package manager | pnpm 10 |
| Node | 20 LTS |
| Deploy | Vercel |

---

## Referencias

- Spec del front Slice 0: `2026-05-07-front-slice-0-scaffold-and-login-design.md`
- Plan del front Slice 0: `2026-05-07-front-slice-0-scaffold-and-login.md`
- Diseño extraído: `araguaney_front/design/_extracted/`
- Mockup: `araguaney_front/design/all-modules.html`
- Tailwind v4 `@theme` docs: https://tailwindcss.com/docs/theme
- shadcn theming: https://ui.shadcn.com/docs/theming
