# Railway Production Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Desplegar `araguaney_back` a Railway con un único ambiente de producción, conectado a la Supabase existente, con auto-deploy desde `main`, health check sin ping de DB, errores reportados a Sentry, y un primer smoke test en prod.

**Architecture:** Repo conectado a un Railway service que hace build via Nixpacks (auto-detecta pnpm + Node 20 + Prisma postinstall) y arranca `node dist/main.js`. El servicio expone `/health` como endpoint público sin DB ping para que Railway use zero-downtime deploys. Errores no-HTTP se reportan a Sentry vía hook en `AllExceptionsFilter`. Migraciones SQL siguen siendo manuales en Supabase Studio. Secrets viven solo en Railway env vars.

**Tech Stack:** Railway (Nixpacks builder), NestJS 10, Prisma 5, pnpm 10, Node 20, `@sentry/node` v8, Pino structured logs, Supabase Postgres + Auth.

**Spec:** `docs/superpowers/specs/2026-05-07-railway-production-deploy-design.md`

---

## File Structure

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `src/modules/health/health.controller.ts` | modificar | Endpoint `/health` minimal sin DB ping |
| `src/modules/health/health.controller.test.ts` | modificar | Tests del nuevo contrato |
| `src/modules/health/health.service.ts` | borrar | Ya no se usa |
| `src/modules/health/health.module.ts` | modificar | Remover provider de HealthService |
| `src/main.ts` | modificar | Excluir `/health` del prefix `/api`; init Sentry antes del bootstrap |
| `src/sentry.ts` | crear | `initSentry(dsn, env)` — no-op si DSN vacío |
| `src/sentry.test.ts` | crear | Verificar comportamiento de `initSentry` |
| `src/common/filters/all-exceptions.filter.ts` | modificar | `Sentry.captureException` solo para errores no-HTTP |
| `src/common/filters/all-exceptions.filter.test.ts` | crear | Verificar capture solo en branch unhandled |
| `src/config/env.config.ts` | modificar | Agregar `SENTRY_DSN` opcional |
| `src/config/env.config.test.ts` | modificar | Tests del parsing de SENTRY_DSN |
| `.env.example` | modificar | Documentar `SENTRY_DSN=` |
| `package.json` | modificar | Agregar `@sentry/node` y script `postinstall` |
| `railway.toml` | crear | Config de Railway versionada en git |

**Tasks operacionales** (sin código):

| Acción | Owner | Cuándo |
|---|---|---|
| Crear proyecto Sentry y obtener DSN | tú | antes de Task 4 |
| Crear servicio en Railway + conectar repo + setear env vars | tú | antes de Task 11 |
| Configurar branch protection en GitHub | tú | después del primer deploy verde |

---

## Task 1: Strip `/health` a respuesta minimal sin DB ping

**Por qué:** Q6 = a en el spec. Hoy `/health` hace `SELECT 1` → si Supabase tose, Railway marca el deploy unhealthy y rebotea el container. Lo queremos al revés: que `/health` solo confirme que el proceso Node está vivo.

**Files:**
- Modify: `src/modules/health/health.controller.ts`
- Modify: `src/modules/health/health.controller.test.ts`
- Delete: `src/modules/health/health.service.ts`
- Modify: `src/modules/health/health.module.ts`

- [ ] **Step 1: Reescribir el test para el contrato minimal**

Reemplazar el contenido completo de `src/modules/health/health.controller.test.ts` con:

```ts
import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();
    controller = moduleRef.get(HealthController);
  });

  it('returns { status: "ok" } without touching the database', () => {
    const result = controller.health();
    expect(result).toEqual({ status: 'ok' });
  });

  it('does not depend on PrismaService (no DI)', () => {
    // Construir el controller sin providers verifica que no hay deps inyectadas
    expect(controller).toBeDefined();
  });
});
```

Nota: importar `beforeEach` de vitest:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm test src/modules/health/health.controller.test.ts`
Expected: FAIL — el controller actual usa `HealthService` y devuelve campos extra.

- [ ] **Step 3: Reescribir el controller a la versión minimal**

Reemplazar el contenido completo de `src/modules/health/health.controller.ts` con:

```ts
import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
```

- [ ] **Step 4: Borrar `health.service.ts`**

```bash
rm src/modules/health/health.service.ts
```

- [ ] **Step 5: Quitar el provider del módulo**

Reemplazar el contenido completo de `src/modules/health/health.module.ts` con:

```ts
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
})
export class HealthModule {}
```

- [ ] **Step 6: Correr todos los tests + typecheck**

Run: `pnpm typecheck && pnpm test`
Expected: PASS — 0 errores.

- [ ] **Step 7: Commit**

```bash
git add src/modules/health/
git commit -m "feat(health): strip /health to minimal status, remove DB ping

Per Railway deploy spec Q6: /health no longer pings the database.
Service Node up != Postgres up — avoiding reboot loops on Supabase
blips. HealthService deleted (no longer used).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Excluir `/health` del prefix `/api`

**Por qué:** Railway pega el health check directo a la raíz del servicio (`https://<host>/health`), sin saber del prefix `/api`. Si dejamos `/health` montado en `/api/health`, Railway lo marca unhealthy.

**Files:**
- Modify: `src/main.ts:20`

- [ ] **Step 1: Actualizar `setGlobalPrefix`**

En `src/main.ts`, cambiar la línea 20 de:

```ts
app.setGlobalPrefix('api');
```

A:

```ts
app.setGlobalPrefix('api', { exclude: ['health'] });
```

- [ ] **Step 2: Verificar que el server arranca + dual mount funciona**

Run en una terminal:

```bash
NODE_ENV=development pnpm dev
```

Esperar a ver `Listening on http://localhost:3001/api`. Después, en otra terminal:

```bash
curl -i http://localhost:3001/health
# Expected: HTTP/1.1 200 OK, body {"status":"ok"}

curl -i http://localhost:3001/api/health
# Expected: HTTP/1.1 404 Not Found (porque ya no está montado en /api)

curl -i http://localhost:3001/api/docs
# Expected: HTTP/1.1 200 (Swagger UI sigue funcionando)
```

Detener el server con Ctrl+C.

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat(http): exclude /health from /api global prefix

Railway health check hits the root path; mounting /health outside
the /api prefix lets Railway find it without configuration.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Agregar `SENTRY_DSN` opcional al env schema

**Por qué:** El env config valida con Zod en arranque; cualquier env var nueva pasa por aquí. Mantener `SENTRY_DSN` opcional permite que dev local no necesite Sentry.

**Files:**
- Modify: `src/config/env.config.ts`
- Modify: `src/config/env.config.test.ts`

- [ ] **Step 1: Agregar tests para SENTRY_DSN**

En `src/config/env.config.test.ts`, agregar dentro del `describe('envSchema', ...)` después del último `it` (línea 47):

```ts
  it('parses SENTRY_DSN when provided', () => {
    const r = envSchema.parse({
      ...valid,
      SENTRY_DSN: 'https://abc@o123.ingest.sentry.io/456',
    });
    expect(r.SENTRY_DSN).toBe('https://abc@o123.ingest.sentry.io/456');
  });

  it('treats missing SENTRY_DSN as undefined', () => {
    const r = envSchema.parse(valid);
    expect(r.SENTRY_DSN).toBeUndefined();
  });

  it('rejects malformed SENTRY_DSN', () => {
    expect(() => envSchema.parse({ ...valid, SENTRY_DSN: 'not-a-url' })).toThrow();
  });
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `pnpm test src/config/env.config.test.ts`
Expected: FAIL — los 3 tests nuevos fallan porque el schema no tiene `SENTRY_DSN`.

- [ ] **Step 3: Agregar `SENTRY_DSN` al schema**

En `src/config/env.config.ts`, agregar dentro del `z.object({ ... })` después de `CORS_ORIGINS` (justo antes del `})` que cierra el schema, alrededor de la línea 25):

```ts
  SENTRY_DSN: z.string().url().optional(),
```

El bloque completo queda así (referencia, no reemplazar todo):

```ts
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((s) =>
      s
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),

  SENTRY_DSN: z.string().url().optional(),
});
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `pnpm test src/config/env.config.test.ts`
Expected: PASS — todos los tests verdes.

- [ ] **Step 5: Documentar en `.env.example`**

En `/Users/llam/dev/araguaney_back/.env.example`, agregar al final del archivo (después de la sección CORS):

```
# ---- Observability ----
# Sentry DSN — leave empty in dev/test, set in Railway for prod
SENTRY_DSN=
```

- [ ] **Step 6: Commit**

```bash
git add src/config/env.config.ts src/config/env.config.test.ts .env.example
git commit -m "feat(config): add optional SENTRY_DSN env var

Optional Zod-validated URL. Empty in dev (Sentry no-op), populated
in Railway production.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Instalar `@sentry/node` y crear `initSentry`

**Por qué:** Necesitamos un punto único para inicializar Sentry, llamado antes del bootstrap de Nest para capturar errores de arranque. Si DSN está vacío, Sentry no se inicializa (no-op para dev local).

**Pre-req manual:** Crear proyecto en https://sentry.io/ → Settings → Client Keys → copiar el DSN. Guardarlo para Task 11.

**Files:**
- Modify: `package.json` (agregar dep)
- Create: `src/sentry.ts`
- Create: `src/sentry.test.ts`
- Modify: `src/main.ts` (llamar initSentry antes del bootstrap)

- [ ] **Step 1: Instalar `@sentry/node`**

Run:

```bash
pnpm add @sentry/node@^8.0.0
```

Expected: `package.json` se actualiza, `pnpm-lock.yaml` también.

- [ ] **Step 2: Escribir el test de `initSentry`**

Crear `src/sentry.test.ts` con:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Sentry from '@sentry/node';
import { initSentry } from './sentry';

vi.mock('@sentry/node', () => ({
  init: vi.fn(),
}));

describe('initSentry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes Sentry when DSN is provided', () => {
    initSentry('https://abc@o123.ingest.sentry.io/456', 'production');
    expect(Sentry.init).toHaveBeenCalledWith({
      dsn: 'https://abc@o123.ingest.sentry.io/456',
      environment: 'production',
      tracesSampleRate: 0,
      profilesSampleRate: 0,
    });
  });

  it('is a no-op when DSN is undefined', () => {
    initSentry(undefined, 'development');
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('is a no-op when DSN is empty string', () => {
    initSentry('', 'development');
    expect(Sentry.init).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `pnpm test src/sentry.test.ts`
Expected: FAIL — el archivo `./sentry` no existe.

- [ ] **Step 4: Crear `src/sentry.ts`**

```ts
import * as Sentry from '@sentry/node';

export function initSentry(dsn: string | undefined, env: string): void {
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: env,
    tracesSampleRate: 0,
    profilesSampleRate: 0,
  });
}
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `pnpm test src/sentry.test.ts`
Expected: PASS — los 3 tests verdes.

- [ ] **Step 6: Wirear `initSentry` en `main.ts`**

En `src/main.ts`, agregar el import al tope (después del import de `helmet`, alrededor de línea 5):

```ts
import { initSentry } from './sentry';
```

Y al inicio de la función `bootstrap()` (antes de `NestFactory.create`, línea 11), agregar:

```ts
async function bootstrap(): Promise<void> {
  initSentry(process.env.SENTRY_DSN, process.env.NODE_ENV ?? 'development');

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  // ... resto igual
```

Nota: usamos `process.env` directo aquí (no el `ConfigService` validado) porque `initSentry` corre antes de que Nest cree la app y el `ConfigService` no existe todavía. La validación Zod ocurre milisegundos después en `NestFactory.create`, así que un DSN malformado va a fallar en arranque de todos modos.

- [ ] **Step 7: Verificar que arranca sin DSN (no-op)**

Run en una terminal:

```bash
unset SENTRY_DSN && pnpm dev
```

Expected: log de bootstrap igual que antes, sin mención de Sentry. Detener con Ctrl+C.

- [ ] **Step 8: Verificar typecheck + tests pasan**

Run: `pnpm typecheck && pnpm test`
Expected: 0 errores, 0 fallos.

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-lock.yaml src/sentry.ts src/sentry.test.ts src/main.ts
git commit -m "feat(observability): initialize Sentry with optional DSN

- Add @sentry/node dependency
- New initSentry helper, no-op when DSN is empty
- Wired in main.ts before bootstrap to capture startup errors
- tracesSampleRate=0, errors only (no perf monitoring)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Reportar excepciones no-HTTP a Sentry desde el filter global

**Por qué:** `HttpException` (400, 401, 404, 409) son errores de negocio esperados — no van a Sentry. Pero excepciones no-HTTP (errores de Prisma, throws inesperados, promesas no controladas que llegan al filter) sí — ese es el ruido que Sentry tiene que alertar.

**Files:**
- Modify: `src/common/filters/all-exceptions.filter.ts`
- Create: `src/common/filters/all-exceptions.filter.test.ts`

- [ ] **Step 1: Escribir el test del filter con mock de Sentry**

Crear `src/common/filters/all-exceptions.filter.test.ts` con:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ArgumentsHost, BadRequestException } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { AllExceptionsFilter } from './all-exceptions.filter';

vi.mock('@sentry/node', () => ({
  captureException: vi.fn(),
}));

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let logger: { log: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let response: { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
  let host: ArgumentsHost;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = { log: vi.fn(), error: vi.fn() };
    const jsonMock = vi.fn();
    const statusMock = vi.fn().mockReturnValue({ json: jsonMock });
    response = { status: statusMock, json: jsonMock };
    const request = { method: 'GET', url: '/api/test' };
    host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    } as unknown as ArgumentsHost;
    filter = new AllExceptionsFilter(logger as never);
  });

  it('does NOT report HttpException to Sentry', () => {
    const exc = new BadRequestException('invalid input');
    filter.catch(exc, host);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('reports non-HTTP Error to Sentry', () => {
    const exc = new Error('database exploded');
    filter.catch(exc, host);
    expect(Sentry.captureException).toHaveBeenCalledWith(exc);
  });

  it('reports non-Error throws (string, etc.) to Sentry', () => {
    filter.catch('something bad', host);
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    // It will be wrapped in an Error inside the filter; verify capture called once.
  });

  it('still returns 500 to client for unhandled exceptions', () => {
    filter.catch(new Error('boom'), host);
    expect(response.status).toHaveBeenCalledWith(500);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm test src/common/filters/all-exceptions.filter.test.ts`
Expected: FAIL — `Sentry.captureException` nunca se llama porque el filter no lo invoca todavía.

- [ ] **Step 3: Modificar el filter para reportar a Sentry**

En `src/common/filters/all-exceptions.filter.ts`, agregar el import al tope (después del import de `nestjs-pino`, alrededor de línea 2):

```ts
import * as Sentry from '@sentry/node';
```

Y dentro de la rama de excepción no-HTTP (después del `const err = ...` en la línea 32, antes del `this.logger.error(...)`), agregar:

```ts
    Sentry.captureException(err);
```

El bloque queda así (líneas 32-46 actuales se transforman):

```ts
    const err = exception instanceof Error ? exception : new Error(String(exception));
    Sentry.captureException(err);
    this.logger.error(
      {
        method: request.method,
        url: request.url,
        err: { name: err.name, message: err.message, stack: err.stack },
      },
      'unhandled exception',
    );
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm test src/common/filters/all-exceptions.filter.test.ts`
Expected: PASS — 4 tests verdes.

- [ ] **Step 5: Correr la suite completa + typecheck**

Run: `pnpm typecheck && pnpm test`
Expected: 0 errores, 0 fallos.

- [ ] **Step 6: Commit**

```bash
git add src/common/filters/all-exceptions.filter.ts src/common/filters/all-exceptions.filter.test.ts
git commit -m "feat(observability): report non-HTTP exceptions to Sentry

HttpException (business errors) keeps logging only. Unhandled
exceptions and non-Error throws now go to Sentry.captureException
in addition to the existing Pino error log.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: Agregar script `postinstall` para `prisma generate`

**Por qué:** Nixpacks corre `pnpm install` y después `pnpm build`. Si `prisma generate` no corre entre los dos, `nest build` falla porque `@prisma/client` no tiene tipos. El script `postinstall` se ejecuta automáticamente después de `pnpm install`.

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Agregar el script**

En `/Users/llam/dev/araguaney_back/package.json`, dentro del bloque `"scripts": { ... }`, agregar después de `"db:generate": "prisma generate",` (alrededor de línea 20):

```json
    "postinstall": "prisma generate",
```

El bloque completo (referencia):

```json
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "start": "node dist/main.js",
    "lint": "eslint \"{src,scripts,test}/**/*.ts\" --fix",
    "lint:check": "eslint \"{src,test,scripts}/**/*.ts\"",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "format": "prettier --write \"src/**/*.ts\" \"test/**/*.ts\"",
    "db:generate": "prisma generate",
    "postinstall": "prisma generate",
    "db:pull": "prisma db pull",
    "db:studio": "prisma studio",
    "openapi:export": "ts-node -T -r tsconfig-paths/register scripts/export-openapi.ts"
  },
```

- [ ] **Step 2: Verificar que `pnpm install` dispara `prisma generate`**

Run:

```bash
rm -rf node_modules/.prisma node_modules/@prisma/client/.prisma 2>/dev/null
pnpm install
```

Expected en el output: una línea como `> prisma generate` o `Generated Prisma Client`.

- [ ] **Step 3: Verificar que el build sigue verde**

Run: `pnpm build`
Expected: 0 errores, `dist/main.js` existe.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore(build): add postinstall script for prisma generate

Required for Railway/Nixpacks to generate Prisma Client between
\`pnpm install\` and \`nest build\` without explicit configuration.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: Crear `railway.toml`

**Por qué:** Versionar la config de Railway en git en lugar del dashboard. Define builder, start command, health check path, y política de restart.

**Files:**
- Create: `railway.toml` (raíz del repo)

- [ ] **Step 1: Crear el archivo**

Crear `/Users/llam/dev/araguaney_back/railway.toml` con:

```toml
[build]
builder = "NIXPACKS"

[deploy]
startCommand = "node dist/main.js"
healthcheckPath = "/health"
healthcheckTimeout = 30
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
```

- [ ] **Step 2: Validar sintaxis TOML**

Run:

```bash
node -e "console.log(require('fs').readFileSync('railway.toml','utf8'))" | head -20
```

Expected: el contenido del archivo se imprime sin errores.

- [ ] **Step 3: Commit**

```bash
git add railway.toml
git commit -m "chore(deploy): add railway.toml for production deploy config

Versioned Railway service config: Nixpacks builder, /health check
with 30s timeout, ON_FAILURE restart with max 3 retries.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: Verificación pre-merge en local con build de producción

**Por qué:** Antes de mergear el PR de deploy, queremos confirmar que el bundle de producción arranca limpio en una env como la de Railway. Si algo se rompe, ahora es el momento de detectarlo.

**Files:** ninguno (solo comandos de verificación).

- [ ] **Step 1: Build limpio de producción**

Run:

```bash
rm -rf dist
pnpm build
ls -la dist/main.js
```

Expected: `dist/main.js` existe y `pnpm build` termina sin errores.

- [ ] **Step 2: Arrancar el server con env de producción local**

Run en una terminal (NO usar `pnpm dev`, ese arranca con watch):

```bash
NODE_ENV=production pnpm start
```

Expected: log con `Listening on http://localhost:3001/api`. Dejar corriendo.

- [ ] **Step 3: Verificar `/health` responde sin auth**

En otra terminal:

```bash
curl -i http://localhost:3001/health
```

Expected:
```
HTTP/1.1 200 OK
Content-Type: application/json
{"status":"ok"}
```

- [ ] **Step 4: Verificar que un endpoint protegido sigue requiriendo JWT**

```bash
curl -i http://localhost:3001/api/me
```

Expected: `HTTP/1.1 401 Unauthorized`.

- [ ] **Step 5: Verificar que Swagger UI carga**

Abrir en browser: `http://localhost:3001/api/docs`

Expected: Swagger UI con la lista de endpoints, sin errores de carga.

- [ ] **Step 6: Verificar que Sentry NO se inicializa sin DSN**

En el log del server (paso 2), buscar líneas con "Sentry". No deben aparecer (Sentry está silencioso cuando DSN está vacío). Detener el server con Ctrl+C.

- [ ] **Step 7: Confirmar suite completa + lint + typecheck verdes**

Run:

```bash
pnpm lint:check && pnpm typecheck && pnpm test
```

Expected: 0 fallos en cada uno.

- [ ] **Step 8: Regenerar `openapi.json` (porque `/health` cambió)**

Run:

```bash
pnpm openapi:export
```

Expected: `openapi.json` actualizado en la raíz. `git diff openapi.json` debe mostrar cambios solo en la sección de `/health` (response schema más simple).

- [ ] **Step 9: Commit del openapi regenerado**

```bash
git add openapi.json
git commit -m "chore(openapi): regenerate spec after /health simplification

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: Crear PR y mergear a `main`

**Por qué:** El flujo del repo (Slice 5c) es PR → CI verde → merge a main. Una vez en main, Railway lo va a buildear (cuando esté conectado en Task 10).

**Files:** ninguno.

- [ ] **Step 1: Push de la branch**

Run:

```bash
git push -u origin <nombre-de-tu-branch>
```

- [ ] **Step 2: Abrir PR**

Run:

```bash
gh pr create --title "feat: Railway production deploy preparation" --body "$(cat <<'EOF'
## Summary
- Strip /health to minimal status (no DB ping) per Railway deploy spec
- Exclude /health from /api global prefix
- Add optional SENTRY_DSN env var for production observability
- Wire Sentry in main.ts and AllExceptionsFilter (HttpException excluded)
- Add postinstall: prisma generate for Nixpacks builds
- Add railway.toml with builder, health check, and restart policy
- Regenerate openapi.json

## Test Plan
- [x] pnpm test (all green)
- [x] pnpm lint:check + typecheck (clean)
- [x] curl /health locally (200 + {"status":"ok"})
- [x] curl /api/health locally (404, correct prefix exclusion)
- [x] Server boots with NODE_ENV=production locally
- [ ] First Railway deploy succeeds and health check passes (next)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Si `gh` falla con "must be a collaborator" (mismo problema que en Slice 5c), abrir el PR manualmente desde la URL que sugiere `gh push`.

- [ ] **Step 3: Esperar CI verde**

Verificar en `https://github.com/armandogois-lab/araguaney_back/actions` que el workflow de CI pasa.

- [ ] **Step 4: Mergear el PR**

Click en "Merge pull request" en GitHub. NO mergear hasta que CI esté verde.

- [ ] **Step 5: Sincronizar local con `main`**

```bash
git checkout main
git pull origin main
git branch -d <nombre-de-tu-branch>
```

---

## Task 10: Crear servicio en Railway y configurar env vars

**Por qué:** Railway necesita conocer el repo y los secrets antes del primer deploy. Esto es manual, en el dashboard.

**Pre-req:** tener cuenta en https://railway.app/ con plan Hobby ($5/mes base).

**Files:** ninguno (todo es configuración en dashboard).

- [ ] **Step 1: Crear el proyecto**

1. https://railway.app/new
2. "Deploy from GitHub repo"
3. Autorizar acceso a `armandogois-lab/araguaney_back`
4. Seleccionar el repo

Railway empieza un build automáticamente. Es esperable que el primer build falle por env vars faltantes — vamos a setearlas en el siguiente paso.

- [ ] **Step 2: Setear las variables de entorno**

Ir a Settings → Variables del servicio. Agregar una por una:

| Variable | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `LOG_LEVEL` | `info` |
| `DATABASE_URL` | (de tu `.env` local — port 5432, direct) |
| `DIRECT_URL` | (de tu `.env` local — port 5432, direct) |
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | (de Supabase Studio → Settings → API) |
| `SUPABASE_SERVICE_ROLE_KEY` | (de Supabase Studio → Settings → API) |
| `SUPABASE_JWT_SECRET` | (de Supabase Studio → Settings → API → JWT Settings) |
| `CORS_ORIGINS` | `https://<frontend-domain>` (placeholder válido por ahora; lo actualizamos cuando esté el front) |
| `SENTRY_DSN` | (del proyecto que creaste en Task 4 pre-req) |

NO setear `PORT` — Railway lo inyecta automáticamente.

- [ ] **Step 3: Trigger un nuevo deploy con las env vars**

Settings → Deployments → "Redeploy" en el último deploy fallido.

Expected: build verde, deploy verde, log de Nest "Listening on http://localhost:..." aparece.

Si el build falla con error de Prisma, escape hatch a Dockerfile (fuera de scope de este plan; documentar en una nueva task de seguimiento).

- [ ] **Step 4: Anotar el subdomain asignado**

Settings → Networking → "Generate Domain" (si no se generó solo).

Anotar el subdomain (ej. `araguaney-back-production-xxxx.up.railway.app`). Lo necesitamos en Task 11.

---

## Task 11: Smoke test post-deploy en producción

**Por qué:** Validar que cada decisión del spec (Q1-Q10) se materializó correctamente en el servicio desplegado. Estos comandos son los criterios de éxito del deploy.

**Pre-req:** tener el subdomain de Railway anotado (Task 10 paso 4) y un usuario operador real con password.

**Files:** ninguno (solo verificación).

Sustituir `<subdomain>` por el dominio real (ej. `araguaney-back-production-xxxx.up.railway.app`) y `<email>` / `<pass>` por credenciales reales.

- [ ] **Step 1: Health check público**

```bash
curl -i https://<subdomain>/health
```

Expected: `HTTP/2 200`, body `{"status":"ok"}`.

- [ ] **Step 2: Swagger UI accesible**

Abrir en browser: `https://<subdomain>/api/docs`

Expected: Swagger UI carga con el catálogo completo de endpoints.

- [ ] **Step 3: OpenAPI spec accesible**

```bash
curl -s https://<subdomain>/api/docs/json | head -c 500
```

Expected: JSON válido con `"title":"Cashea CFB API"`.

- [ ] **Step 4: Endpoint protegido rechaza sin auth**

```bash
curl -i https://<subdomain>/api/me
```

Expected: `HTTP/2 401`.

- [ ] **Step 5: Login real**

```bash
curl -i -X POST https://<subdomain>/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<email>","password":"<pass>"}'
```

Expected: `HTTP/2 200`, body con `access_token`. Anotar el token.

- [ ] **Step 6: Endpoint protegido funciona con token**

```bash
TOKEN="<access_token-del-paso-5>"
curl -i -H "Authorization: Bearer $TOKEN" https://<subdomain>/api/me
```

Expected: `HTTP/2 200`, body con info del usuario.

- [ ] **Step 7: CORS preflight funciona**

```bash
curl -i -X OPTIONS https://<subdomain>/api/me \
  -H "Origin: <frontend-domain-de-CORS_ORIGINS>" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: authorization,content-type"
```

Expected: `HTTP/2 204` con header `access-control-allow-origin: <frontend-domain>`.

- [ ] **Step 8: Logs estructurados aparecen en Railway**

1. Railway dashboard → servicio → Logs
2. Las requests anteriores deben aparecer como JSON con campos `req.id`, `req.method`, `req.url`, `res.statusCode`, `responseTime`.

Si no son JSON (texto plano), revisar configuración de Pino — debería estar en JSON cuando `NODE_ENV=production`.

- [ ] **Step 9: Verificar Sentry capturando errores reales**

Disparar un error 500 controlado. Opciones:
- Si tienes un endpoint con un error conocido, llamarlo.
- O esperar a que ocurra naturalmente (no recomendado para validación).

Después de 60 segundos, verificar en `https://sentry.io/` → tu proyecto → Issues:
- Aparece un issue con stack trace
- Tag `environment` = `production`
- Stack trace incluye paths del repo

Si no aparece después de 2 minutos, revisar:
- `SENTRY_DSN` está bien copiado en Railway
- El DSN apunta al proyecto correcto en Sentry
- El error que disparaste fue un error no-HTTP (HttpException no se reporta)

- [ ] **Step 10: Smoke funcional de un slice real**

Usando el token del paso 5, hacer un round-trip de negocio:

```bash
# Listar usuarios (requires admin)
curl -s -H "Authorization: Bearer $TOKEN" https://<subdomain>/api/me | jq '.'

# Listar la matriz de role-permissions (Slice 5c, requires permission.manage)
curl -s -H "Authorization: Bearer $TOKEN" https://<subdomain>/api/role-permissions | jq '.matrix | keys'

# Listar audit log (Slice 5b)
curl -s -H "Authorization: Bearer $TOKEN" "https://<subdomain>/api/audit?limit=5" | jq '.items | length'
```

Expected: las 3 calls devuelven datos reales (no errores).

- [ ] **Step 11: Marcar deploy como exitoso**

Si los 10 pasos anteriores pasaron, el deploy está validado. Anotar en algún lado (Notion, README, donde corresponda) la URL del subdomain de Railway.

---

## Task 12: Configurar branch protection en GitHub

**Por qué:** Hoy un push directo a `main` saltea CI y mergea sin revisar. Con Railway haciendo auto-deploy desde main, eso significa que un push roto va directo a producción. Branch protection bloquea eso.

**Files:** ninguno (configuración en GitHub UI).

- [ ] **Step 1: Abrir branch protection settings**

Navegar a `https://github.com/armandogois-lab/araguaney_back/settings/branches`.

- [ ] **Step 2: Crear regla para `main`**

Click "Add classic branch protection rule" (o "Add rule" según UI):

- Branch name pattern: `main`
- ✅ Require a pull request before merging
- ✅ Require status checks to pass before merging
  - ✅ Require branches to be up to date before merging
  - En el search box, agregar: `lint-typecheck-test` (o el nombre exacto del job de CI; ver `.github/workflows/ci.yml`)
- ❌ Require approvals (eres el único reviewer)
- ❌ Require conversation resolution
- ✅ Do not allow bypassing the above settings (importante: aplica reglas a admins también, o desactivar si quieres bypass)

- [ ] **Step 3: Guardar la regla**

Click "Create" / "Save changes".

- [ ] **Step 4: Verificar que la regla aplica**

Intentar hacer un push directo a main desde local:

```bash
git checkout main
echo "# test" >> /tmp/dummy.md
# NO commit, solo verificar que la regla bloquea pushes directos
```

(No es necesario hacer un push real; alcanza con confirmar visualmente en la UI que la regla está activa.)

---

## Task 13: Próximos pasos (fuera de scope, documentar como follow-ups)

Estas tareas no son parte del primer deploy pero quedan documentadas para no perderse:

- **Custom domain (`api.cashea.app`):** cuando tengas DNS access, agregar en Railway → Settings → Networking → Add Custom Domain. Crear CNAME apuntando al subdomain Railway. Cert TLS se emite automáticamente.
- **Pooler en `DATABASE_URL`:** retestear el auth del pooler de Supabase. Si funciona, cambiar `DATABASE_URL` en Railway al port 6543 con `?pgbouncer=true&connection_limit=1`. Beneficio: mejor scaling, no hace falta hoy con 3 operadores.
- **Frontend domain en `CORS_ORIGINS`:** cuando esté el front desplegado, actualizar la env var en Railway.
- **Endpoint `/debug-sentry` temporal:** opcional para validar Sentry de forma controlada en cualquier deploy. Crear, validar, remover.

---

## Self-Review

Validación del plan contra el spec antes de ejecutar:

**Spec coverage:**
- ✅ Q1 (1 ambiente prod): Task 10
- ✅ Q2 (subdomain Railway, custom después): Task 10 + Task 13 follow-up
- ✅ Q3 (auto-deploy desde main): Task 10 (GitHub connection) + Task 12 (branch protection)
- ✅ Q4 (CORS multi-origen CSV): Task 10 paso 2 (env var) + ya soportado en `env.config.ts`
- ✅ Q5 (DATABASE_URL = DIRECT_URL = direct 5432): Task 10 paso 2
- ✅ Q6 (health check minimal sin DB): Task 1 + Task 2
- ✅ Q7 (Nixpacks): Task 7 (railway.toml) + Task 6 (postinstall)
- ✅ Q8 (migraciones SQL manuales): documentado en spec, no requiere código
- ✅ Q9 (Sentry para errores no-HTTP): Task 4 + Task 5
- ✅ Q10 (Railway env vars como single source): Task 10 paso 2

**Placeholder scan:** No hay TBD/TODO en el plan. Los `<subdomain>`, `<email>`, `<pass>` en Task 11 son templates intencionales que el ejecutor sustituye con valores runtime.

**Type consistency:** `initSentry(dsn, env)` con esa firma exacta en Task 4 step 4 y referenciada en Task 4 step 6.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-07-railway-production-deploy.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, two-stage review (spec compliance + code quality) between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session with batch checkpoints

**Which approach?**
