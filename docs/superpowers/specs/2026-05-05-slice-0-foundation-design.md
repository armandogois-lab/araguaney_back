# Slice 0 — Foundation: diseño

**Fecha**: 2026-05-05
**Autor**: armandogois@cashea.app + Claude (brainstorming)
**Estado**: en revisión
**Próximo paso**: tras aprobación, invocar writing-plans para producir el plan de implementación

---

## 1. Contexto y objetivo

`araguaney_back` está en estado de bootstrap: `package.json`, scaffolding inicial NestJS y un `prisma/schema.prisma` placeholder de 12 líneas. Las 19 tablas del producto **ya están migradas** a Supabase (proyecto `esobivqsddwrbxlytfsn`), con seeds básicos cargados. Pero las migraciones se aplicaron a mano vía SQL Editor y **no están versionadas** en el repo (`infra/sql/` solo tiene un `README.md`).

Slice 0 cierra la brecha entre código y DB para que los siguientes slices puedan agregar lógica sobre un fundamento estable, reproducible y auditado.

### Objetivos concretos

1. **Reconciliar repo ↔ DB**: extraer el schema vivo de Supabase a archivos SQL idempotentes en `infra/sql/` (`001 → 007`), de forma que aplicar `001` a `007` desde una DB vacía produzca un estado byte-equivalente al actual de Supabase (más un fix de invariante, ver objetivo 3).

2. **Sincronizar Prisma**: poblar `prisma/schema.prisma` con los 19 modelos + 10 enums introspectados desde Supabase, configurado con `multiSchema` y dejando que los blindajes a nivel DB (triggers, funciones, RLS, índices parciales) vivan solo en SQL.

3. **Cerrar el gap de la regla 1 (Maturity boundary)**: agregar el blindaje DB que falta — un trigger que rechace asignaciones de orden a certificado donde la cuota más tardía vence después del vencimiento del certificado.

4. **Construir el cimiento de código NestJS**: env validado con Zod, `PrismaService` funcional, logger Pino con redacción de secretos, `AllExceptionsFilter` global, `ZodValidationPipe` global, healthcheck público, exportador de OpenAPI, tests Vitest mínimos.

### Fuera de alcance (queda para slices posteriores)

- Cualquier endpoint de dominio (ingestión, cartera, emisión, certificados).
- `PermissionsGuard` y verificación de JWT — Slice 1.
- Tests de integración contra Supabase real — Slice 1.
- CRUD de operadores (`/api/users`).

---

## 2. Auditoría de invariantes (resultado)

Verificación caja-por-caja contra Supabase.

### Lo que SÍ está blindado en la DB (no se toca)

| Invariante | Implementación verificada |
|---|---|
| Regla 2 (Order indivisibility) | `UNIQUE (order_id)` en `cfb.certificate_orders` |
| Regla 3 (Round-down only) | `CHECK (nominal_actual <= nominal_target)` en `cfb.certificates` |
| Un sweep por ciclo | `uq_certs_one_sweep_per_cycle`: partial unique on `(cycle_week)` WHERE `certificate_type = 'sweep' AND deleted_at IS NULL` |
| Un solo investor `internal` | `uq_investors_one_internal`: partial unique on `(kind)` WHERE `kind = 'internal'` |
| Un nombre de merchant vigente | `uq_mnh_one_current_per_merchant`: partial unique on `(merchant_id)` WHERE `effective_to IS NULL` |
| Plazos solo 14/42 | `CHECK (term_days = ANY (ARRAY[14, 42]))` en `cfb.certificates` |
| `maturity > issue` | `CHECK (maturity_date > issue_date)` |
| Identidad capital + yield | Dos `CHECK` con epsilon 0.01: `investor_paid + investor_returned ≈ investor_capital` y `investor_yield ≈ nominal_actual - investor_paid` |
| Inmutabilidad de eventos | Trigger `prevent_mutation` BEFORE UPDATE/DELETE en `audit_log`, `order_events`, `installment_events`, `certificate_events` |
| Singletons | `CHECK (id = 1)` en `settings` y `certificate_sequence` |
| Anti-suplantación en INSERT | RLS `with_check` exige `uploaded_by_id`/`issued_by_id`/`assigned_by_id` = `cfb.current_user_id()` |
| Funciones helper de auth | `current_user_id`, `current_user_role`, `has_permission`, `is_admin`, `is_authenticated_user` |
| RLS habilitado en las 19 tablas | Sí, con policies usando `cfb.has_permission('...')` |

### Gap encontrado: Regla 1 (Maturity boundary) NO blindada

**CLAUDE.md** afirma: *"Ninguna cuota puede vencer después del vencimiento del certificado. ... blindadas a nivel de base de datos."* — pero no hay `CHECK` ni trigger en Supabase que valide esto.

**Cómo se cierra en este slice (`007_invariants_complete.sql`)**:

- Función `cfb.enforce_maturity_boundary()` (plpgsql) que, antes de INSERT o UPDATE de `(order_id, certificate_id)` en `cfb.certificate_orders`, verifica:
  ```sql
  IF (SELECT max_due_date FROM cfb.orders WHERE id = NEW.order_id)
     > (SELECT maturity_date FROM cfb.certificates WHERE id = NEW.certificate_id)
  THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = format('La cuota más tardía de la orden %s vence después del vencimiento del certificado %s', NEW.order_id, NEW.certificate_id);
  END IF;
  RETURN NEW;
  ```
- Trigger `trg_co_maturity_boundary` BEFORE INSERT OR UPDATE OF (`order_id`, `certificate_id`) ON `cfb.certificate_orders`.

---

## 3. Migraciones SQL en `infra/sql/`

### Orden y contenido

Cada archivo está envuelto en `BEGIN; ... COMMIT;`, es idempotente, y declara sus dependencias en un comentario de cabecera.

| # | Archivo | Contenido |
|---|---|---|
| 001 | `001_init.sql` | `CREATE SCHEMA IF NOT EXISTS cfb` · `CREATE EXTENSION IF NOT EXISTS pgcrypto, "uuid-ossp"` · 10 ENUMs · 6 tablas transversales (`users`, `permissions`, `role_permissions`, `audit_log`, `settings`, `documents`) · funciones `current_user_id`, `current_user_role`, `has_permission`, `is_admin`, `is_authenticated_user` · función `prevent_mutation` + trigger en `audit_log` |
| 002 | `002_ingestion.sql` | 3 tablas: `excel_uploads`, `batches`, `import_errors` (FKs a `users` de 001) |
| 003 | `003_portfolio.sql` | 7 tablas: `merchants`, `merchant_name_history`, `end_users`, `orders`, `order_events`, `installments`, `installment_events` · funciones `log_order_status_change`, `touch_merchant_last_seen` · triggers `prevent_mutation` en `order_events` y `installment_events`, `trg_orders_status_log`, `trg_orders_touch_seen` |
| 004 | `004_issuance.sql` | 5 tablas: `investors`, `certificate_sequence`, `certificates`, `certificate_orders`, `certificate_events` · funciones `log_certificate_status_change`, `next_certificate_code` · triggers `prevent_mutation` en `certificate_events`, `trg_certs_status_log` · índices únicos parciales `uq_certs_one_sweep_per_cycle`, `uq_investors_one_internal` · todos los `CHECK` de invariantes (round-down, term_days, capital identity, yield identity, maturity > issue, etc.) |
| 005 | `005_rls_policies.sql` | `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` en las 19 tablas · ~50 `CREATE POLICY` (precedidos por `DROP POLICY IF EXISTS` para idempotencia) reproduciendo exactamente las policies vivas en Supabase |
| 006 | `006_seeds.sql` | 20 `INSERT` en `permissions` con `ON CONFLICT (key) DO NOTHING` · 40 `INSERT` en `role_permissions` con `ON CONFLICT (role, permission_id) DO NOTHING` · 1 `INSERT` en `investors` (Cashea internal, `kind='internal'`) · 1 `INSERT` en `certificate_sequence` con **los valores actuales que están en Supabase** (no desde C4572A — lo que está vivo manda) · 1 `INSERT` en `settings` con valores actuales |
| 007 | `007_invariants_complete.sql` | Función `enforce_maturity_boundary` + trigger `trg_co_maturity_boundary` BEFORE INSERT OR UPDATE OF (`order_id`, `certificate_id`) ON `certificate_orders` |

### Idempotencia: técnicas aplicadas

- Schemas/extensions: `CREATE ... IF NOT EXISTS`.
- Tablas e índices: `CREATE TABLE/INDEX IF NOT EXISTS`.
- Enums (PG 17 no soporta `IF NOT EXISTS` para `CREATE TYPE`): bloque `DO $$ BEGIN CREATE TYPE ...; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`.
- Funciones: `CREATE OR REPLACE FUNCTION`.
- Triggers: `DROP TRIGGER IF EXISTS ... CREATE TRIGGER ...`.
- Policies: `DROP POLICY IF EXISTS ... CREATE POLICY ...`.
- Seeds: `INSERT ... ON CONFLICT (...) DO NOTHING`.

### Cómo se llena cada archivo

Para reconstruir el DDL real:

1. Para cada tabla: query a `information_schema.columns` + `pg_attribute` + `pg_attrdef` para obtener tipos exactos, defaults, NOT NULL.
2. Para FKs: `pg_constraint` con `pg_get_constraintdef` para reproducir `ON DELETE`/`ON UPDATE` actions reales.
3. Para CHECKs: ya capturados en la auditoría (sección 2 — anexo en este spec si hace falta).
4. Para triggers/funciones: `pg_get_functiondef`.
5. Para políticas RLS: ya capturadas en la auditoría.

Los nombres autogenerados de constraint con OIDs (ej. `17546_17721_1_not_null`) **no se transcriben**. Estrategia única: el `NOT NULL` queda inline en la columna (`amount NUMERIC(18,4) NOT NULL`), sin un constraint separado con nombre. Esto es lo que produce `CREATE TABLE` cuando una columna se define como NOT NULL desde el inicio, y elimina la dependencia de los nombres OID-based generados por PG.

### Garantía verificable

Después de aplicar `001 → 007` contra una DB vacía, el output de `pg_dump --schema-only --schema=cfb` debe ser equivalente al estado actual de Supabase + el trigger `trg_co_maturity_boundary` adicional. Esta verificación se ejecuta **manualmente** una vez durante la implementación de Slice 0, comparando dumps. La automatización del check en CI queda fuera de alcance de este slice (ver sección 7, riesgos).

### Aplicación a Supabase

El operador (no Claude) aplica `007_invariants_complete.sql` desde el SQL Editor de Supabase Studio. Los archivos `001 → 006` no se "aplican" — son la documentación versionada del estado vivo.

---

## 4. Sincronización Prisma (`prisma/schema.prisma`)

### Configuración

```prisma
generator client {
  provider        = "prisma-client-js"
  output          = "../node_modules/.prisma/client"
  previewFeatures = ["multiSchema"]
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")  // pooler (puerto 6543) para app runtime
  directUrl = env("DIRECT_URL")    // direct (puerto 5432) para introspección/CLI
  schemas   = ["cfb"]
}
```

- `multiSchema` es obligatorio porque todo vive en `cfb`.
- **Schema `auth` no se incluye**. CLAUDE.md prohíbe tocar `auth.*`. La columna `users.auth_user_id` queda como `String @db.Uuid` sin relación Prisma; la integridad referencial la mantiene el FK SQL existente.

### Convención de naming

CLAUDE.md dice: *"Tablas DB y columnas: snake_case en inglés (mapeadas con `@@map`/`@map` en Prisma)"*.

**Decisión tomada en este slice (deviación pragmática)**:

- **Modelos en PascalCase con `@@map`** a snake_case (ej. `model Order { ... @@map("orders") @@schema("cfb") }`).
- **Campos en snake_case** (ej. `installments_sum`, no `installmentsSum`). **No** se aplica `@map` por campo.
- Razón: ahorra ≈300+ mapeos manuales de campos y reduce el riesgo de drift entre `@map` y la columna real. La API TypeScript queda con `order.installments_sum` — ligeramente menos idiomático pero perfectamente legible y sincronizado con la DB sin esfuerzo.

Esta deviación queda registrada y debería trasladarse a CLAUDE.md o a un ADR en `docs/DECISIONS/` después del slice.

### Tipos críticos

| Columna en DB | Tipo Prisma | Notas |
|---|---|---|
| `numeric(18, 4)` (dinero) | `Decimal @db.Decimal(18, 4)` | Sin excepción. Nunca `Float`/`number`. |
| `numeric(7, 6)` (tasas) | `Decimal @db.Decimal(7, 6)` | |
| `date` | `DateTime @db.Date` | Para fechas naturales. |
| `timestamptz` | `DateTime @db.Timestamptz(6)` | Para eventos. |
| `uuid` (PK) | `String @db.Uuid @default(dbgenerated("gen_random_uuid()"))` | |
| `jsonb` (`*_events.payload`, `audit_log.payload`) | `Json` | |
| ENUMs `cfb.*` | enum Prisma con `@@map` y `@@schema("cfb")` | 10 enums. |

### Lo que Prisma NO representa (vive solo en SQL)

- Triggers: `prevent_mutation`, `log_*_status_change`, `touch_merchant_last_seen`, `enforce_maturity_boundary`.
- Funciones: `current_user_id`, `has_permission`, `next_certificate_code`, etc.
- RLS policies.
- Índices únicos parciales (`uq_certs_one_sweep_per_cycle`, `uq_investors_one_internal`, `uq_mnh_one_current_per_merchant`, `idx_certs_status` parcial, `idx_orders_eligibility` parcial, `idx_end_users_national_id` parcial). Prisma no soporta `WHERE` en `@@index`. **Si la introspección los inserta como warnings, se borran del schema.prisma**: el blindaje no se pierde, queda solo en los archivos SQL.

### Validación post-pull

1. `pnpm prisma generate` corre limpio (cero warnings).
2. Diff manual de modelos generados vs conteo real: 19 modelos, 10 enums.
3. Smoke test (en `health.controller.test.ts`): el cliente Prisma compila contra TypeScript strict y un `prisma.permission.count()` funcional devolvería 20.

---

## 5. Capa NestJS (foundation de código)

### 5.1 Validación de env (`src/config/env.config.ts`)

Schema Zod que valida `process.env` al arranque. Si falla → proceso muere con `exit(1)`.

```
NODE_ENV                       development | test | production  (default development)
PORT                           number                            (default 3000)
DATABASE_URL                   url   (Supabase pooler, puerto 6543)
DIRECT_URL                     url   (Supabase direct, puerto 5432)
SUPABASE_URL                   url
SUPABASE_ANON_KEY              string
SUPABASE_SERVICE_ROLE_KEY      string  (NUNCA enviar al cliente)
SUPABASE_JWT_SECRET            string  (consumido en Slice 1)
LOG_LEVEL                      fatal|error|warn|info|debug|trace|silent  (default info)
CORS_ORIGINS                   coma-separado de URLs (default http://localhost:3001)
```

Integrado vía `ConfigModule.forRoot({ isGlobal: true, validate })`. `.env.example` se actualiza con todas las claves (sin valores reales).

### 5.2 PrismaService (`src/prisma/prisma.service.ts`)

- `extends PrismaClient implements OnModuleInit, OnModuleDestroy`.
- Constructor configura `log: [{ emit: 'event', level: 'error' }, { emit: 'event', level: 'warn' }]` y reenvía a Pino.
- `onModuleInit()` → `await this.$connect()`.
- `onModuleDestroy()` → `await this.$disconnect()`.
- Método `enableShutdownHooks(app)` para cerrar limpio en SIGTERM.

`PrismaModule` lo expone como `@Global()` provider.

### 5.3 Logger Pino (`nestjs-pino`)

`LoggerModule.forRootAsync` con:

- `level` desde `LOG_LEVEL`.
- En `NODE_ENV=development`: `pino-pretty` single-line.
- En producción: JSON estructurado.
- **Redacción** obligatoria: `req.headers.authorization`, `req.headers.cookie`, `*.password`, `*.SUPABASE_SERVICE_ROLE_KEY`, `*.SUPABASE_JWT_SECRET`. Censor `[REDACTED]`.
- `genReqId` respeta `x-request-id` entrante; si falta, genera UUID.

Mensajes de negocio en español llegan al cliente vía `HttpException`. Logs internos van en inglés. La separación la enforce el filter de errores, no el logger.

### 5.4 `main.ts` y `AppModule`

`AppModule` agrupa: `ConfigModule` (global, validado), `LoggerModule`, `PrismaModule`, `HealthModule`.

Bootstrap en `main.ts`:

1. `NestFactory.create(AppModule, { bufferLogs: true })`.
2. `app.useLogger(app.get(Logger))` (Pino).
3. `app.setGlobalPrefix('api')`.
4. `app.useGlobalPipes(new ZodValidationPipe())` (de `nestjs-zod`).
5. `app.useGlobalFilters(new AllExceptionsFilter(app.get(Logger)))`.
6. `app.use(helmet())`.
7. `app.enableCors({ origin: env.CORS_ORIGINS, credentials: true })`.
8. `app.enableShutdownHooks()`.
9. `SwaggerModule.setup('api/docs', app, document)` — UI en `/api/docs`, spec JSON en `/api/docs-json`.
10. `app.listen(env.PORT)`.

### 5.5 Filters y pipes compartidos

`src/common/filters/all-exceptions.filter.ts`:

- Si la excepción es `HttpException` (business error) → propaga el mensaje al cliente (en español), loguea en `info`/`warn` (no `error`).
- Si es cualquier otra excepción (técnica) → responde `500` con mensaje genérico en español (`"Ocurrió un error inesperado"`), loguea el stack trace en inglés con request-id correlado.

`src/common/pipes/zod-validation.pipe.ts`:

- Captura `ZodError` y lo convierte a `BadRequestException` con payload estructurado en español:
  ```json
  {
    "statusCode": 400,
    "message": "Datos de entrada inválidos",
    "errors": [{ "path": "..", "message": "..." }]
  }
  ```

### 5.6 Healthcheck (`src/modules/health/`)

Estructura:

```
src/modules/health/
  health.module.ts
  health.controller.ts
  health.service.ts
  health.controller.test.ts
```

`GET /api/health` (público, sin auth):

- Ejecuta `await prisma.$queryRaw\`SELECT 1\`` con timeout corto.
- Respuesta `200` cuando OK:
  ```json
  {
    "status": "ok",
    "timestamp": "2026-05-05T12:00:00.000Z",
    "uptime": 123.45,
    "version": "0.1.0",
    "database": { "status": "ok", "latencyMs": 12 }
  }
  ```
- Respuesta `503` cuando DB falla, con `database.status: "down"`. Error original logueado en inglés, NO expuesto al cliente.
- **Solo chequea DB** en Slice 0. Auth/Storage se chequearán en endpoints separados si hace falta.

### 5.7 Export OpenAPI (`scripts/export-openapi.ts`)

Script standalone (`pnpm openapi:export`):

1. `NestFactory.create(AppModule, { logger: false })` — no escucha puerto.
2. Configura el mismo `SwaggerModule` que `main.ts`.
3. `SwaggerModule.createDocument(app, config)`.
4. `fs.writeFileSync('./openapi.json', JSON.stringify(document, null, 2))`.
5. `app.close()` y `process.exit(0)`.

`openapi.json` se commitea al repo. CLAUDE.md ya promete que `araguaney_front` lo consume con `openapi-typescript`.

### 5.8 Tests Vitest (mínimo viable de Slice 0)

| Archivo | Tipo | Verifica |
|---|---|---|
| `src/config/env.config.test.ts` | unit | El schema Zod rechaza envs faltantes / con tipos inválidos. Casos: falta `DATABASE_URL`, `PORT='abc'`, `LOG_LEVEL='loud'`. |
| `src/modules/health/health.controller.test.ts` | unit (con `Test.createTestingModule` y `PrismaService` mockeado) | `GET /api/health` devuelve `200` + estructura cuando DB ok; `503` cuando `$queryRaw` rechaza. |
| `src/app.bootstrap.test.ts` | smoke | El módulo arranca sin crashear con env válido y Prisma mockeado. |

**Fuera de alcance**: integration tests contra Supabase real. Se reservan para Slice 1.

### 5.9 Estructura final del repo después de Slice 0

```
src/
  main.ts
  app.module.ts
  config/
    env.config.ts
    env.config.test.ts
  common/
    filters/all-exceptions.filter.ts
    pipes/zod-validation.pipe.ts
  prisma/
    prisma.module.ts
    prisma.service.ts
  modules/
    health/
      health.module.ts
      health.controller.ts
      health.service.ts
      health.controller.test.ts
prisma/
  schema.prisma                    (lleno con db pull + ajustes manuales)
infra/
  sql/
    README.md
    001_init.sql
    002_ingestion.sql
    003_portfolio.sql
    004_issuance.sql
    005_rls_policies.sql
    006_seeds.sql
    007_invariants_complete.sql
scripts/
  export-openapi.ts
docs/
  CONSTITUTION.md
  DECISIONS/
  superpowers/specs/
    2026-05-05-slice-0-foundation-design.md
.env.example                       (todas las vars)
openapi.json                       (generado, commiteado)
```

---

## 6. Decisiones tomadas (no re-discutir en implementación)

1. **Reconciliar repo con DB existente, no recrear desde cero**. La DB de Supabase es la fuente de verdad para este slice. Las migraciones SQL son el reflejo versionado.
2. **6 archivos SQL agrupados por dominio + 1 archivo de fix de invariante** = 7 totales (`001 → 007`).
3. **Cerrar el gap de la regla 1 en este slice**, no posponer. Las 3 reglas duras se blindan juntas.
4. **`certificate_sequence` seed usa los valores actuales de Supabase**, no `C4572A` literal de CLAUDE.md.
5. **Prisma fields en snake_case** (sin `@map` por campo) — deviación pragmática de CLAUDE.md.
6. **Modelos Prisma en PascalCase con `@@map`**.
7. **Schema `auth` NO incluido en Prisma**. `users.auth_user_id` es UUID sin relación.
8. **Healthcheck liviano**: solo `SELECT 1`, no toca Auth/Storage.
9. **Sin tests de integración real** en este slice; se reservan para Slice 1.
10. **CORS en dev**: `http://localhost:3001` por defecto, ajustable vía env.
11. **Package manager**: `pnpm` (confirmado por `pnpm-lock.yaml` + `pnpm-workspace.yaml`).
12. **`directUrl`** se incluye en el `datasource` para introspección y futuras `prisma migrate` (aunque las migraciones reales viven en `infra/sql/`).

---

## 7. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| El DDL extraído de Supabase difiere sutilmente del que se usó al migrar a mano (ej. defaults distintos) | Diff manual exhaustivo + el principio "la DB viva manda" — si hay drift, gana lo que está corriendo. |
| Aplicar `007_invariants_complete.sql` falla porque ya existen `certificate_orders` que violarían el nuevo trigger | Antes de aplicar, query de validación: `SELECT count(*) FROM cfb.certificate_orders co JOIN cfb.orders o ON o.id = co.order_id JOIN cfb.certificates c ON c.id = co.certificate_id WHERE o.max_due_date > c.maturity_date`. Si > 0, abortar y reportar. (Actualmente `certificate_orders` tiene 0 filas → no es problema, pero el chequeo queda como buena práctica.) |
| `prisma db pull` reformatea modelos de forma inesperada | Run pull en branch separado, commit, después aplicar refinamientos manuales en commits separados — historial trazable. |
| Drift futuro entre `infra/sql/` y Supabase real (alguien cambia algo a mano y se olvida de versionar) | No hay automation aún. Queda como deuda para un slice posterior (CI check con `pg_dump` diff). |
| `CORS_ORIGINS` mal configurado bloquea al frontend | Default sano (`http://localhost:3001`) en `.env.example` + log de origins permitidos al arranque para debug. |

---

## 8. Criterios de aceptación

Slice 0 está listo cuando:

1. `infra/sql/001_*.sql` … `007_*.sql` existen, son idempotentes, están commiteados.
2. Aplicar `007` a Supabase produce el trigger `trg_co_maturity_boundary` activo (verificable con la query que muestra triggers).
3. `prisma/schema.prisma` tiene 19 modelos + 10 enums, configuración con `multiSchema` y `cfb` schema, `pnpm prisma generate` corre limpio.
4. `pnpm dev` arranca la app, conecta a Supabase, expone `GET /api/health` que devuelve `200` con `database.status: "ok"`.
5. `GET /api/docs` muestra Swagger UI con el `HealthController` documentado.
6. `pnpm openapi:export` genera `openapi.json` commiteable.
7. `pnpm test` corre y pasa los 3 tests de Vitest.
8. `pnpm lint` y `pnpm typecheck` corren limpio.
9. `.env.example` está completo con todas las variables requeridas.
10. El repo tiene su primer commit (es el bootstrap inicial).

---

## 9. Siguiente paso

Tras la aprobación del usuario sobre este spec → invocar `superpowers:writing-plans` para producir el plan paso-a-paso.
