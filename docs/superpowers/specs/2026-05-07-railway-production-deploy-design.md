# Railway Production Deployment — Design Spec

**Fecha:** 2026-05-07
**Estado:** Aprobado, listo para implementation plan
**Slices anteriores:** 0 → 5c (todos mergeados a `main`)

---

## Goal

Desplegar `araguaney_back` a producción en Railway, conectado a la Supabase existente (que actuará como prod DB), con auto-deploy desde `main`, observabilidad mínima vía Sentry, y un runbook operativo para el equipo de un solo deployer (tú).

## Non-Goals (YAGNI)

- Staging o preview environments. Single environment: producción.
- Migraciones SQL automatizadas. Siguen siendo manuales vía Supabase Studio.
- Performance monitoring de Sentry (`tracesSampleRate: 0`).
- Password manager para secrets (Q10 = a, Railway env vars solamente).
- Dockerfile custom (Q7 = c, Nixpacks default; Dockerfile solo si Nixpacks falla).
- Custom domain en el primer deploy (se agrega después sin downtime).
- Pooler de Supabase para `DATABASE_URL` (Q5 = b, replicamos el direct-only del local; pooler queda como upgrade futuro).

## Decisiones cerradas (Q&A brainstorm)

| Q | Decisión | Razón |
|---|---|---|
| Q1 | Solo producción, 1 servicio | 3 operadores, staging es overhead innecesario |
| Q2 | Subdomain Railway primero + custom domain después | No bloquearse por DNS, agregar `api.cashea.app` cuando haya acceso |
| Q3 | Auto-deploy desde `main` | CI verde como gate único, flujo `PR → merge → live` |
| Q4 | CORS multi-origen CSV | Permite tener subdomain Railway del front + futuro `app.cashea.app` |
| Q5 | `DATABASE_URL` = `DIRECT_URL` = direct port 5432 | Replicar workaround local; evitar nueva variable de riesgo en primer deploy |
| Q6 | Health check mínimo `/health` sin DB ping | Service Node up != Postgres up; evitar reboot loops por blips de Supabase |
| Q7 | Nixpacks default, Dockerfile escape hatch | Stack bien soportado; no escribir Dockerfile a menos que falle |
| Q8 | Migraciones SQL manuales en Supabase Studio | Volumen bajo (~1/slice), evita riesgo de automatización contra prod |
| Q9 | Pino logs (Railway stdout) + Sentry para errores | Sentry alerta proactiva; audit_log de Slice 5b da retroactividad de negocio |
| Q10 | Railway env vars como única fuente de secrets | Setup mínimo; password manager queda como mejora opcional |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ GitHub: armandogois-lab/araguaney_back                  │
│   PR → CI (lint/typecheck/test) → merge a main          │
└────────────────────────┬────────────────────────────────┘
                         │ webhook
                         ▼
┌─────────────────────────────────────────────────────────┐
│ Railway: servicio "araguaney-back" (1 ambiente: prod)   │
│   Builder: Nixpacks (default)                           │
│   Build: pnpm install + prisma generate + nest build    │
│   Start: node dist/main.js                              │
│   Health: GET /health → 200                             │
│   Domain: araguaney-back.up.railway.app                 │
│           (+ futuro api.cashea.app)                     │
└────────────┬───────────────────────────┬────────────────┘
             │                           │
             ▼                           ▼
┌─────────────────────────┐   ┌─────────────────────────┐
│ Supabase (existente)    │   │ Sentry (nuevo)          │
│   Postgres (schema cfb) │   │   Errores no controlados│
│   Auth (JWT)            │   │   Plan: free tier       │
│   Storage (3 buckets)   │   │                         │
└─────────────────────────┘   └─────────────────────────┘
```

**Características:**

- **Un único entorno** en Railway: producción. CI bloquea merges con tests rojos.
- **Misma Supabase** que se usa en local — los datos del CFB son únicos, no hay test data que mezclar.
- **Sentry** captura excepciones no-HTTP y promesas no controladas vía el filter global. Logs Pino siguen yendo a stdout (Railway dashboard).
- **DNS dual:** subdomain Railway desde el día 1, custom domain agregable después sin downtime.

---

## Cambios de código y configuración

### 1. Health endpoint

**Crear:** `src/modules/health/health.controller.ts`

```ts
import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check() {
    return { status: 'ok' };
  }
}
```

**Crear:** `src/modules/health/health.module.ts` registrando el controller.

**Modificar:** `src/app.module.ts` para importar `HealthModule`.

**Modificar:** `src/main.ts` para excluir `/health` del prefijo global:

```ts
app.setGlobalPrefix('api', { exclude: ['health'] });
```

Notas:
- `@Public()` ya existe (lo usa `/api/auth/login`). Bypassa `JwtAuthGuard` global.
- No toca DB → respuesta <10ms incluso si Supabase está caído.
- Sin prefijo `/api` para que Railway no necesite saber del prefix.

### 2. Sentry

**Paquete nuevo:** `@sentry/node`.

**Crear:** `src/sentry.ts`

```ts
import * as Sentry from '@sentry/node';

export function initSentry(dsn: string | undefined, env: string) {
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: env,
    tracesSampleRate: 0,
    profilesSampleRate: 0,
  });
}
```

**Modificar:** `src/main.ts` para llamar `initSentry(process.env.SENTRY_DSN, process.env.NODE_ENV)` antes del bootstrap de Nest.

**Modificar:** `src/common/filters/all-exceptions.filter.ts` para capturar excepciones no-HTTP a Sentry antes de loguear y devolver 500. (No reportar `HttpException` — son errores de negocio esperados.)

**Modificar:** `src/config/env.schema.ts` para agregar:

```ts
SENTRY_DSN: z.string().url().optional()
```

**Modificar:** `.env.example` agregando `SENTRY_DSN=` (vacío en local).

Notas:
- DSN opcional: sin DSN seteado, Sentry no se inicializa (local dev no necesita Sentry).
- `tracesSampleRate: 0` apaga performance monitoring; solo capturamos errores.
- No usamos request handler ni interceptors de Sentry; el filter global de NestJS es el único hook.

### 3. Configuración Railway

**Crear:** `railway.toml` en la raíz del repo

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

Notas:
- Configuración versionada en git, no en dashboard.
- `healthcheckTimeout: 30` da margen al cold start de Nest (~5-10s).
- `restartPolicyMaxRetries: 3` evita loops infinitos por env mal seteado.

### 4. Verificar `postinstall` para Prisma

**Modificar (si no existe):** `package.json` agregando script

```json
{
  "scripts": {
    "postinstall": "prisma generate"
  }
}
```

Si ya existe el script (de Slice 0), no se toca.

Sin esto, Nixpacks hace `pnpm install` pero `nest build` falla porque `@prisma/client` no tiene tipos generados.

### 5. Variables de entorno en Railway

| Var | Valor | Sensitive |
|---|---|---|
| `NODE_ENV` | `production` | no |
| `PORT` | (Railway lo inyecta) | no |
| `LOG_LEVEL` | `info` | no |
| `DATABASE_URL` | direct port 5432 | sí (contiene password) |
| `DIRECT_URL` | direct port 5432 | sí |
| `SUPABASE_URL` | `https://<ref>.supabase.co` | no |
| `SUPABASE_ANON_KEY` | de Supabase Studio | sí |
| `SUPABASE_SERVICE_ROLE_KEY` | de Supabase Studio | sí |
| `SUPABASE_JWT_SECRET` | de Supabase Studio | sí |
| `CORS_ORIGINS` | TBD del frontend (CSV) | no |
| `SENTRY_DSN` | de sentry.io project | sí |

`PORT` lo inyecta Railway automáticamente; no se hardcodea.

### Resumen de archivos tocados

| Archivo | Acción |
|---|---|
| `src/modules/health/health.controller.ts` | crear |
| `src/modules/health/health.module.ts` | crear |
| `src/app.module.ts` | modificar |
| `src/main.ts` | modificar |
| `src/sentry.ts` | crear |
| `src/common/filters/all-exceptions.filter.ts` | modificar |
| `src/config/env.schema.ts` | modificar |
| `.env.example` | modificar |
| `package.json` | modificar (si `postinstall` no existe) |
| `railway.toml` | crear |

---

## Deployment flow

```
1. Trabajas en branch feature
2. Si el slice incluye SQL nueva (infra/sql/0XX_*.sql):
   → la aplicas a Supabase prod desde Studio ANTES de mergear
3. Abres PR → CI corre (lint + typecheck + test)
4. CI verde + tu review → merge a main
5. Railway recibe webhook → arranca build:
   - pnpm install (ejecuta postinstall: prisma generate)
   - nest build → dist/
6. Railway hace zero-downtime deploy:
   - Arranca el nuevo container
   - Espera health check (GET /health = 200)
   - Cambia tráfico al nuevo
   - Mata el viejo
7. Listo (~2-3 min total desde merge)
```

**Branch protection en GitHub** (configuración manual en `Settings → Branches`):
- Branch pattern: `main`
- ✅ Require a pull request before merging
- ✅ Require status checks to pass (selecciona el job de CI)
- ✅ Require branches to be up to date before merging
- ❌ Require approvals (eres el único reviewer)

---

## Runbook operativo

### Rollback

**Opción A — Railway redeploy (más rápido):**
1. Dashboard de Railway → Deployments → encontrar el último deploy bueno
2. Click "Redeploy"
3. Tiempo: <30s

**Opción B — Git revert (correcta si la causa raíz no es solo código):**
1. `git revert <merge-commit>`
2. Push a `main` (o PR + merge si branch protection bloquea)
3. CI corre → Railway despliega
4. Tiempo: ~3 min

### Rotación de secrets

1. Supabase Studio → Settings → API → reset key
2. Copiar nuevo valor
3. Railway → Variables → editar var → guardar (rebootea automático)
4. Verificar `/health` y un endpoint protegido funcionan

**Riesgo:** rotar `SUPABASE_JWT_SECRET` invalida JWTs vigentes. Hacer fuera de horario operativo.

### Aplicar migración SQL

1. **Antes** de mergear el PR: Supabase SQL Editor en prod
2. Pegar contenido de `infra/sql/0XX_nueva.sql`
3. Run → verificar 0 errores
4. Mergear PR → Railway despliega el código

**Por qué en este orden:** migración primero, código después. Si haces lo opuesto y la migración falla, el código corre contra una DB sin las columnas que espera → 500s. Las migraciones son idempotentes (`IF NOT EXISTS` / `DO/EXCEPTION duplicate_object`), correrlas dos veces no rompe nada.

### Investigar error en producción

```
1. Sentry te avisa por email
2. Click en el issue → stack trace + request context
3. Más contexto:
   - Railway dashboard → Logs → filtrar por timestamp
   - Buscar request_id (Pino lo emite por línea)
4. Bug de código: branch fix → PR → CI → merge → auto-deploy
5. Bug de datos: Supabase SQL Editor + cfb.audit_log
```

---

## Costos esperados

| Servicio | Plan | Costo mensual |
|---|---|---|
| Railway | Hobby ($5 base + uso) | ~$5-15/mes |
| Supabase | (existente) | $0 free / lo que ya pagas |
| Sentry | Free tier | $0 (5k errores/mes) |
| Custom domain | (futuro) | depende de Cashea |
| **Total nuevo** | | **~$5-15/mes** |

---

## Testing y verificación

### Pre-merge (en local)

```bash
pnpm build                                    # 0 errores, dist/main.js
NODE_ENV=production node dist/main.js         # arranca sin errores
curl http://localhost:3000/health             # {"status":"ok"} HTTP 200
curl http://localhost:3000/api/users/me       # 401
pnpm test                                     # 0 failures
```

Sentry NO se inicializa en local (sin DSN seteado).

### Post-deploy en Railway

```bash
# <subdomain> = el que asigne Railway

curl https://<subdomain>.up.railway.app/health
# Esperado: {"status":"ok"} HTTP 200

curl -I https://<subdomain>.up.railway.app/api/docs
# Esperado: HTTP 200

curl https://<subdomain>.up.railway.app/api/docs/json | jq '.info.title'
# Esperado: nombre del API

curl -i https://<subdomain>.up.railway.app/api/users/me
# Esperado: 401

# Login real
curl -X POST https://<subdomain>.up.railway.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<operador>","password":"<pass>"}'
# Esperado: HTTP 200, body con access_token

# Endpoint protegido con token
TOKEN=<access_token>
curl -H "Authorization: Bearer $TOKEN" \
  https://<subdomain>.up.railway.app/api/users/me
# Esperado: HTTP 200

# CORS preflight
curl -i -X OPTIONS https://<subdomain>.up.railway.app/api/users/me \
  -H "Origin: <frontend-domain>" \
  -H "Access-Control-Request-Method: GET"
# Esperado: HTTP 204 con Access-Control-Allow-Origin
```

### Verificación de Sentry

Forzar un error 500 (endpoint temporal `/debug-sentry` que tira `throw new Error("sentry test")`, removerlo después). Verificar en dashboard de Sentry:

- Issue aparece <60s
- Stack trace incluye file paths del repo
- Tag `environment = production`

### Verificación de logs

Railway dashboard → Logs:
- Hacer request a `/health`
- Verificar log line con timestamp matcheando
- Verificar JSON estructurado (Pino), no texto plano
- Campos esperados: `request_id`, `method`, `url`, `status`, `duration_ms`

### Verificación de la build de Nixpacks

En logs del primer build, confirmar:

- ✓ Detecta Node 20 (`engines.node ">=20"`)
- ✓ Detecta pnpm (`pnpm-lock.yaml`)
- ✓ Corre `pnpm install`
- ✓ Corre `postinstall` script (`prisma generate`)
- ✓ Corre `pnpm build`
- ✓ Imagen incluye `dist/`, `node_modules/`, `prisma/`
- ✓ Start command: `node dist/main.js`

Si alguno falla → escape hatch a Dockerfile multi-stage.

### Smoke test funcional

Round-trip de negocio en prod:

1. Login como `operator`
2. POST `/api/uploads` → subir Excel chico de prueba
3. GET `/api/batches/:id` → verificar procesamiento
4. Login como `admin`
5. GET `/api/audit?entity_type=batch` → ver evento del upload
6. GET `/api/role-permissions` → ver matriz cargada

### Criterios de éxito del deploy

- ✅ `/health` responde 200
- ✅ Login funciona y devuelve JWT válido
- ✅ Endpoint protegido responde con JWT
- ✅ Swagger UI carga
- ✅ Logs aparecen como JSON estructurado en Railway
- ✅ Error forzado aparece en Sentry
- ✅ Smoke test funcional pasa
- ✅ Frontend (cuando se conecte) hace request CORS exitoso

Si todo pasa → marcar deploy completo y proceder a configurar custom domain (`api.cashea.app`) cuando haya acceso DNS.

---

## Referencias externas

- Railway docs: https://docs.railway.app/
- Nixpacks Node provider: https://nixpacks.com/docs/providers/node
- Sentry NestJS guide: https://docs.sentry.io/platforms/node/guides/nestjs/
- Supabase connection pooling: https://supabase.com/docs/guides/database/connecting-to-postgres
