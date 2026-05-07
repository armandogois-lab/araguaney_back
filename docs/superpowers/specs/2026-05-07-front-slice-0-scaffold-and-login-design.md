# Frontend Slice 0 — Scaffold + Login Design Spec

**Fecha:** 2026-05-07
**Estado:** Aprobado, listo para implementation plan
**Repo afectado:** `araguaney_front` (vacío hoy en GitHub)
**Repo dependiente:** `araguaney_back` desplegado en https://araguaneyback-production.up.railway.app

---

## Goal

Establecer el scaffolding completo del frontend de Cashea CFB y entregar un flujo de login funcional contra el backend de producción. Al final del slice, un operador puede ir a la URL del front en Vercel, ingresar email + password, y aterrizar en una pantalla "Hola {nombre}" con un botón de logout.

## Non-Goals (YAGNI)

- Layout autenticado completo (sidebar, topbar, navegación) → Slice 1
- Cualquier feature de negocio (batches, portfolio, certificates, admin) → Slice 2+
- Dark mode → cuando se justifique
- Internationalization (i18n) — Spanish-only es un requirement
- Refresh tokens / sliding sessions — el JWT de Supabase dura 1h, lo revisamos cuando aparezca un caso real
- E2E tests (Playwright) — overkill para Slice 0; se agrega en Slice 2-3 cuando haya features para cubrir end-to-end
- Storybook / visual regression — no aplica al volumen de UI actual
- TanStack Query en uso real — se instala y configura provider, pero las primeras pantallas no lo usan (no hay listas que cachear todavía)

## Decisiones cerradas (Q&A brainstorm)

| Q | Decisión | Razón |
|---|---|---|
| Q1 | Slice 0 = scaffold + login (sin layout) | Login es una unidad coherente; meter el layout completo lo hace muy grande |
| Q2 | Next.js 15 + App Router | Estándar actual; Server Components reducen bundle JS |
| Q3 | shadcn/ui + Tailwind | Componentes en el repo (modificables), bundle chico, comunidad enorme |
| Q4 | TanStack Query | Soporta CFB con pantallas interactivas (filtros, búsquedas, refetch on focus) |
| Q5 | HttpOnly cookie + middleware | JWT no toca JavaScript del cliente, idiomático en App Router |
| Q6 | Vercel ahora, migración a Railway si hace falta | Free tier + preview deploys + integración nativa con Next |
| Q7 | Specs/plans en `araguaney_back/docs/` | Un solo lugar para back+front, facilita history search |

## Preferencia explícita del usuario

> "Me gustaría componentizar todo, y que quede todo lo más modular posible."

Aplicación práctica: archivos pequeños con una responsabilidad, componentes UI compuestos de partes más chicas, separación clara entre routing (`app/`), UI (`components/`), y lógica (`lib/`).

## Mockup del login

No hay mockup para Slice 0 → se usa layout shadcn estándar: Card centrado en viewport con email + password + botón submit. Cuando lleguen mockups para slices posteriores, se replicarán pixel a pixel.

---

## Architecture

```
araguaney_front (Next.js 15 App Router) ──→ Vercel (auto-deploy desde main)
       │
       │ HttpOnly cookie 'cfb_token' + Authorization: Bearer en server-side fetch
       ▼
araguaney_back (Railway)
       │
       ▼
  Supabase (Postgres + Auth)
```

**Flujo de login:**

```
/login (server component)
  └─ <LoginForm> (client, react-hook-form + zod)
       └─ submit → loginAction (server action)
            ├─ POST /api/auth/login al back
            │     └─ back valida con Supabase, devuelve {access_token, user}
            ├─ setSessionCookie(jwt) — HttpOnly Secure SameSite=Lax
            └─ redirect('/')
                  └─ middleware: cookie OK → continúa
                       └─ / (server component)
                            ├─ getCurrentUser() — GET /api/me con Bearer
                            └─ "Hola {full_name}" + <LogoutButton>
```

**Características:**

- **Server-first**: `/login` y `/` son Server Components. Auth (Server Actions + middleware) corre en el server de Vercel.
- **Modular**: cada componente UI <150 líneas, lógica de fetch separada en `lib/api/`, tipada desde el OpenAPI del back.
- **Despliegue**: cada push a `main` → Vercel build → producción. Cada PR genera preview deploy automático.

---

## File Structure

```
araguaney_front/
├─ app/
│  ├─ layout.tsx                   # root layout + providers
│  ├─ globals.css                  # Tailwind base + shadcn vars
│  ├─ (auth)/                      # route group: rutas públicas
│  │  └─ login/
│  │     ├─ page.tsx               # server: renderiza <LoginForm>
│  │     └─ actions.ts             # loginAction (server action)
│  └─ (app)/                       # route group: rutas autenticadas
│     ├─ layout.tsx                # SSR: lee cookie, getMe(), pasa user
│     ├─ page.tsx                  # placeholder "Hola {name}"
│     └─ logout/
│        └─ actions.ts             # logoutAction (server action)
│
├─ components/
│  ├─ ui/                          # primitivos shadcn (button, input, form, card, label)
│  ├─ auth/
│  │  ├─ login-form.tsx            # client: form con RHF + zod + shadcn Form
│  │  └─ logout-button.tsx         # client: button que dispara logoutAction
│  └─ providers/
│     └─ query-provider.tsx        # TanStack QueryClientProvider
│
├─ lib/
│  ├─ api/
│  │  ├─ client.ts                 # typed fetch wrapper (server-side, lee cookie)
│  │  ├─ auth.ts                   # login(email, pass), logout()
│  │  └─ me.ts                     # getMe()
│  ├─ auth/
│  │  ├─ cookie.ts                 # nombre, set/clear/read (server-only)
│  │  └─ session.ts                # getCurrentUser() para Server Components
│  ├─ env.ts                       # validación de env vars con zod
│  └─ utils.ts                     # cn() de shadcn
│
├─ types/
│  └─ openapi.d.ts                 # generado desde back's openapi.json (gitignored)
│
├─ middleware.ts                   # gate: cookie o redirect a /login
│
├─ scripts/
│  └─ generate-types.ts            # corre openapi-typescript
│
├─ test/
│  └─ helpers/                     # utilidades de test (mocks, fixtures)
│
├─ .env.example
├─ next.config.ts
├─ tailwind.config.ts
├─ components.json                 # shadcn config
├─ tsconfig.json
├─ vitest.config.ts
├─ .eslintrc.cjs
├─ .prettierrc
├─ package.json
└─ pnpm-lock.yaml
```

**Tres capas claras:**

1. **`app/`** — solo rutas y server actions. Pages son shells delgadas (5-10 líneas), delegan al componente real en `components/`.
2. **`components/`** — UI pura, dividida por dominio (`auth/`) más primitivos (`ui/`).
3. **`lib/`** — lógica sin JSX. La capa `api/` es la única que habla con el back. La capa `auth/` es server-only.

**Convenciones:**

- Files: `kebab-case.tsx` para componentes y rutas, `kebab-case.ts` para lógica
- Exports: `PascalCase` para componentes y tipos, `camelCase` para funciones
- TypeScript strict, paths absolutos (`@/components/...`, `@/lib/...`)
- Tests colocados al lado del archivo (`login-form.test.tsx`)

---

## Auth Flow Detail

### Cookie helpers (`lib/auth/cookie.ts`, server-only)

```ts
export const COOKIE_NAME = 'cfb_token';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24,  // 24h — match Supabase JWT default
};

export async function setSessionCookie(jwt: string): Promise<void>;
export async function clearSessionCookie(): Promise<void>;
export async function readSessionCookie(): Promise<string | undefined>;
```

Una función por operación. Usa `cookies()` async de Next.js 15.

### Server action (`app/(auth)/login/actions.ts`)

Valida input con zod, llama `lib/api/auth.ts:login()`, setea cookie, redirige. Si el back devuelve 401, retorna `{ error: <mensaje del back> }` para que el formulario lo muestre.

Mensaje de error en español **excepto** los mensajes de auth (401/403) que el back devuelve en inglés según preferencia explícita del usuario (memory: `feedback_auth_messages_english.md`).

### Middleware (`middleware.ts`)

```ts
const PUBLIC_PATHS = ['/login'];

export function middleware(request: NextRequest) {
  const hasToken = request.cookies.has(COOKIE_NAME);
  const isPublic = PUBLIC_PATHS.includes(request.nextUrl.pathname);

  if (!hasToken && !isPublic) return redirect('/login');
  if (hasToken && isPublic) return redirect('/');
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next|api|favicon|.*\\..*).*)'],
};
```

Solo verifica **presencia** de cookie, no valida el JWT. Mantener el middleware simple es importante: corre en cada request.

### API client (`lib/api/client.ts`)

```ts
export async function apiFetch<P extends keyof paths>(
  path: P,
  init?: RequestInit & { auth?: 'required' | 'optional' | 'none' },
);
```

Server-side. Lee la cookie, agrega `Authorization: Bearer <jwt>`. Si el back responde 401, limpia la cookie automáticamente (next request del usuario el middleware lo redirige).

### Edge cases cubiertos

- **JWT expirado** → back devuelve 401 → cliente limpia cookie → siguiente request → middleware redirect a /login
- **Logout en otra pestaña** → cookie borrada → mismo flujo
- **JWT tampered** → back rechaza → mismo flujo
- **Usuario abre /login estando logueado** → middleware redirect a /

---

## Type Generation Pipeline

### Script (`scripts/generate-types.ts`)

Lee `openapi.json` del back y emite `types/openapi.d.ts` usando `openapi-typescript`.

**Dos fuentes posibles:**

1. **Local**: `../araguaney_back/openapi.json` (cuando los repos están lado a lado en dev)
2. **HTTP**: `https://araguaneyback-production.up.railway.app/api/docs-json` (CI)

Selección vía env var `OPENAPI_SOURCE`. Default: ruta local. CI: URL de prod.

### Cuándo regenerar

```json
"scripts": {
  "types:generate": "tsx scripts/generate-types.ts",
  "predev": "pnpm types:generate",
  "prebuild": "pnpm types:generate"
}
```

Cada `pnpm dev` y cada `pnpm build` (CI + Vercel) regeneran.

### Uso en código

```ts
// lib/api/auth.ts
import type { paths } from '@/types/openapi';
type LoginInput  = paths['/api/auth/login']['post']['requestBody']['content']['application/json'];
type LoginOutput = paths['/api/auth/login']['post']['responses']['200']['content']['application/json'];
```

Si el back cambia el shape de un endpoint, TypeScript flagea el error en `pnpm typecheck` antes de mergear.

`types/openapi.d.ts` está en `.gitignore` — siempre se regenera.

---

## Testing Strategy

**Vitest** (mismo runner que el back) con tres niveles:

| Nivel | Qué probar | Ejemplos Slice 0 |
|---|---|---|
| Unit | funciones puras, validators | `lib/auth/cookie.ts`, zod schema del login |
| Component | componentes con `@testing-library/react` | `<LoginForm>` (typing → submit → loading) |
| Server actions | invocando con FormData mock + mock de la API | `loginAction` (happy path + 401) |

**Mocks necesarios:**

- `fetch` — vía `vi.fn()`
- `next/navigation` (`redirect`) — `vi.mock('next/navigation', ...)`
- `next/headers` (`cookies()`) — `vi.mock('next/headers', ...)`

**Coverage objetivo:** 80%+ en `lib/`, 100% de zod schemas. UI se cubre por componente, no por porcentaje.

**Smoke test manual** (`pnpm smoke:auth`): script que hace POST `/api/auth/login` al back de prod con credenciales reales, verifica `{ access_token, user }`, después GET `/api/me` con el token. **No corre en CI** (necesita credenciales). Lo ejecutamos antes de mergear cambios en `lib/api/`.

---

## CI + Deploy

### CI (`.github/workflows/ci.yml`)

Corre en PR y push a `main`:

```yaml
- pnpm install --frozen-lockfile
- pnpm types:generate          # genera tipos desde URL de prod
- pnpm lint:check
- pnpm typecheck
- pnpm test
- pnpm build
```

CI no corre `pnpm dev` ni e2e tests. `pnpm build` valida que el bundle se construye limpio.

### Deploy a Vercel

**Setup inicial (manual, una vez):**

1. https://vercel.com/new → import `araguaney-front` desde GitHub
2. Vercel auto-detecta Next.js (no requiere config adicional)
3. Settings → Environment Variables: `NEXT_PUBLIC_API_URL` y `OPENAPI_SOURCE` para Production, Preview, Development
4. Settings → Domains: anotar el dominio asignado (`araguaney-front.vercel.app` o similar)
5. Avisar al back: agregar el dominio del front a `CORS_ORIGINS` en Railway env vars

**Auto-deploy:**

- Push a `main` → Production deploy
- PR abierto → Preview deploy con URL única (compartible para review)

**Branch protection en GitHub:**

- `main` requires PR + status checks (CI verde) → merge

### Env vars

| Variable | Local (`.env.local`) | Vercel (prod) | Usada en |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001/api` | `https://araguaneyback-production.up.railway.app/api` | `lib/api/client.ts` |
| `OPENAPI_SOURCE` | `../araguaney_back/openapi.json` | `https://araguaneyback-production.up.railway.app/api/docs-json` | `scripts/generate-types.ts` |

`NEXT_PUBLIC_*` se inyecta al bundle del cliente para usos futuros desde TanStack Query (Slice 2+). Validación con zod en `lib/env.ts` — si falta una env var crítica, el build falla en lugar de fallar en runtime.

---

## Tech Stack Summary

| Decisión | Valor |
|---|---|
| Framework | Next.js 15 + App Router |
| UI | shadcn/ui + Tailwind |
| Data fetching | TanStack Query (instalado, uso desde Slice 2+) |
| Auth | HttpOnly cookie + middleware + Server Actions |
| Forms | react-hook-form + zod (built-in en shadcn Form) |
| Tipos | openapi-typescript desde back's openapi.json |
| Tests | Vitest + Testing Library |
| Linting | ESLint + Prettier |
| Package manager | pnpm 10 (pinned via `packageManager`) |
| Node | 20 LTS |
| Deploy | Vercel (auto-deploy desde main) |
| Specs/plans | `araguaney_back/docs/superpowers/` |

---

## Criterios de éxito de Slice 0

- ✅ Repo `araguaney-front` poblado (no vacío)
- ✅ `pnpm dev` arranca en localhost:3000 sin errores
- ✅ Visitar `/` sin cookie → redirect a `/login`
- ✅ Login con credenciales válidas → redirect a `/` con "Hola, {full_name}"
- ✅ Login con credenciales inválidas → muestra error en español (mensaje del back)
- ✅ Botón de logout en `/` → cookie limpiada → redirect a `/login`
- ✅ Visitar `/login` con cookie válida → redirect a `/`
- ✅ Tipos del back consumidos correctamente en `lib/api/auth.ts`
- ✅ `pnpm test` verde (unit + component + server actions)
- ✅ `pnpm build` verde
- ✅ Deploy a Vercel exitoso
- ✅ Smoke test contra back de prod funciona (`pnpm smoke:auth`)
- ✅ CORS del back actualizado para incluir el dominio del front

---

## Referencias

- Spec del back Slice 0 (foundation): `2026-05-05-slice-0-foundation-design.md`
- Spec del back Slice 1 (auth): `2026-05-05-slice-1-auth-design.md`
- Railway production deploy del back: `2026-05-07-railway-production-deploy-design.md`
- Next.js 15 docs: https://nextjs.org/docs
- shadcn/ui docs: https://ui.shadcn.com/
- TanStack Query docs: https://tanstack.com/query/latest
- openapi-typescript: https://openapi-ts.dev/
