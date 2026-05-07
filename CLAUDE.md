# Araguaney Backend — Contexto del proyecto para Claude Code

> Este archivo se carga automáticamente al inicio de cada sesión de Claude Code
> en este repo. Léelo completo antes de empezar a trabajar — contiene las
> decisiones que ya están tomadas y NO se discuten cada vez.

## Qué es este proyecto

`araguaney_back` es el **backend** del sistema **Cashea CFB**, una herramienta interna de back-office para que el equipo de Tesorería de **Cashea** (empresa BNPL venezolana) empaquete cuotas de órdenes BNPL en **Certificados de Financiamiento Bursátil (CFB)** que se venden a inversores a través de la Bolsa de Valores de Caracas (BVC).

- **Usuarios**: 3 operadores de Tesorería (no es app cara al cliente)
- **Estructurador**: Mercantil Merinvest Casa de Bolsa
- **Marco regulatorio**: Circular SUNAVAL DSNV/GCI/00014
- **Idioma del producto**: español
- **Repo hermano**: [`araguaney_front`](https://github.com/armandogois-lab/araguaney_front) (Next.js)

## Comunicación con el frontend

Los dos repos están **deliberadamente separados**. La comunicación es vía HTTP REST con contrato OpenAPI:

1. Este backend expone Swagger UI en `/api/docs` y el spec en `/api/docs-json`
2. El script `pnpm openapi:export` (o `npm run openapi:export`) genera `./openapi.json` en la raíz
3. El frontend consume ese spec con `openapi-typescript` para generar tipos TS automáticamente

Cuando agregas un endpoint nuevo, **regenera y commitea `openapi.json`** para que el frontend lo pueda consumir sin clonar este repo.

## Las 3 reglas duras del producto (invariantes)

Estas reglas son inviolables y están blindadas a nivel de base de datos:

1. **Maturity boundary**: Ninguna cuota puede vencer después del vencimiento del certificado.
2. **Order indivisibility**: Una orden entra completa a un certificado o no entra. Implementada con `UNIQUE (order_id)` en `cfb.certificate_orders`.
3. **Round-down only**: La suma de cuotas en el pool nunca puede exceder `nominal_target`. El gap se devuelve al inversor en cash.

Cualquier código que viole una de estas reglas es un bug, no una feature.

## Producto en 1 página

- **Plazos**: ENUM 14 días o 42 días (no hay otros)
- **Convenio de días**: Actual/360 (siempre)
- **Modalidad**: A descuento (`price = 1 - rate × days / 360`)
- **Tasa**: libre por certificado, negociada con cada inversor, **inmutable** después de emitir
- **Código del certificado**: formato `C{NNNN}{LETRA}` continuando secuencia desde `C4572A`

### Cálculos

```
price             = 1 − (annual_rate × term_days / 360)
nominal_target    = investor_capital / price
nominal_actual    = Σ installments_sum de orders asignadas (≤ target)
investor_paid     = nominal_actual × price
investor_returned = investor_capital − investor_paid    (cash refund)
investor_yield    = nominal_actual − investor_paid      (paid at maturity)
shortfall_pct     = (nominal_target − nominal_actual) / nominal_target
```

### Tipos de certificado

- `standard`: emitido a inversor externo durante la semana
- `sweep`: certificado de barrido emitido los viernes con todo el stock remanente, comprado por la propia Cashea (`kind = 'internal'` en `investors`). Solo puede haber **uno por ciclo semanal**, blindado con partial unique index.

## Stack

| Capa | Tecnología |
|---|---|
| Runtime | Node.js 20 LTS |
| Framework | NestJS 10 |
| Lenguaje | TypeScript 5 (strict) |
| ORM | Prisma 5 |
| Validación | Zod + `nestjs-zod` |
| OpenAPI | `@nestjs/swagger` |
| Logger | Pino (`nestjs-pino`) |
| Config | `@nestjs/config` validado con Zod |
| Tests | Vitest |
| DB | Supabase Postgres (schema `cfb`) |
| Auth | Supabase Auth (verificación de JWT) |
| Storage | Supabase Storage (3 buckets privados) |

## Estructura del repo

```
src/
  main.ts                # bootstrap de la app
  app.module.ts          # módulo raíz
  config/                # env vars validadas con Zod
  modules/               # módulos de dominio (auth, batches, certificates, etc.)
  common/                # decoradores, guards, filters compartidos
  prisma/                # PrismaService inyectable
prisma/
  schema.prisma          # fuente de verdad de tipos (sincronizado con infra/sql)
infra/
  sql/                   # migraciones SQL idempotentes para Supabase (001 → 006)
scripts/
  export-openapi.ts      # genera openapi.json para que lo consuma araguaney_front
docs/
  CONSTITUTION.md
  DECISIONS/             # ADRs cuando una decisión grande cambia
```

## Convenciones

### Naming

- Tablas DB y columnas: `snake_case` en inglés (mapeadas con `@@map`/`@map` en Prisma)
- Clases TypeScript: `PascalCase` (ej. `CertificateService`)
- Variables y funciones: `camelCase`
- Constantes globales: `SCREAMING_SNAKE_CASE`
- Módulos NestJS: convención del framework — `*.module.ts`, `*.service.ts`, `*.controller.ts`, `*.dto.ts`

### Tipos numéricos

- **Dinero**: `Decimal` de Prisma (mapea a `NUMERIC(18, 4)` en DB). **NUNCA Float ni Number**.
- **Tasas porcentuales**: `Decimal(7, 6)` en DB.
- **Fechas naturales** (compras, vencimientos): `Date` en TS, `DATE` en DB.
- **Eventos** (timestamps): `Date` en TS, `TIMESTAMPTZ` en DB.

### DTOs y validación

- Todos los inputs de endpoints se validan con **Zod schemas**, no con `class-validator`.
- Los schemas viven cerca del controller que los usa: `*.dto.ts`.
- Usar `nestjs-zod` para que los schemas Zod alimenten OpenAPI automáticamente.

### Errores

- Errores de negocio: lanzar excepciones HTTP de NestJS (`BadRequestException`, etc.) con mensaje en **español** porque ese mensaje llega al usuario final.
- Errores técnicos: dejar que el filter global los capture y los loguee en **inglés** (logs internos).

## Modelo de datos

19 tablas en el schema `cfb` de Supabase, organizadas en 4 dominios:

- **Ingestión**: `excel_uploads`, `batches`, `import_errors`
- **Cartera**: `merchants`, `merchant_name_history`, `end_users`, `orders`, `order_events`, `installments`, `installment_events`
- **Emisión**: `investors`, `certificates`, `certificate_orders`, `certificate_events`, `certificate_sequence`
- **Transversal**: `users`, `permissions`, `role_permissions`, `audit_log`, `settings`, `documents`

El `schema.prisma` completo vive en `prisma/schema.prisma`. Las migraciones SQL idempotentes para Supabase viven en `infra/sql/` (aplicar en orden 001 → 006 desde el SQL Editor de Supabase).

**Soft-delete habilitado** en `certificates`, `certificate_orders`, `audit_log`. El resto es hard-delete (pero las tablas `*_events` son inmutables — solo INSERT, bloqueado por trigger).

## Autorización

- 3 roles: `operator`, `admin`, `auditor`
- ~20 permisos granulares en `cfb.permissions`
- Matriz `cfb.role_permissions` editable en producción sin redeploy
- RLS policies de Postgres usan `cfb.has_permission('key')`
- El backend **verifica el JWT de Supabase Auth** y mapea al usuario en `cfb.users`
- Para transacciones atómicas que requieren bypass de RLS (emisión de certificados), el backend usa `SUPABASE_SERVICE_ROLE_KEY`. **Esa key NUNCA va al frontend**.

### Decoradores de autorización

Implementar (más adelante) un decorador `@RequirePermission('certificate.issue')` que use un `PermissionsGuard` para verificar contra `cfb.role_permissions`.

## Cosas que NO debes hacer

- ❌ Sustituir el stack sin preguntar (no Express directo, no Drizzle, no TypeORM, no Fastify-only, no class-validator)
- ❌ Tocar el schema `auth.*` o `storage.*` de Supabase — son del provider
- ❌ Crear tablas en `public` — todo va en `cfb`
- ❌ Usar `Float` o `number` para dinero, jamás. Siempre `Decimal`.
- ❌ Hardcodear rates, plazos o thresholds — vienen de `cfb.settings` o del input del operador
- ❌ Implementar `DELETE` físico en `certificates` o `audit_log` — usar soft-delete
- ❌ Usar `console.log` — usar el logger inyectado de Pino
- ❌ Asumir un timezone — siempre `TIMESTAMPTZ` y `Date` con UTC, formatear en la UI
- ❌ Inferir reglas de negocio que no estén explícitas — preguntar antes de inventar
- ❌ Exponer el `SUPABASE_SERVICE_ROLE_KEY` en respuestas, logs, o cualquier lugar visible al cliente
- ❌ Modificar `openapi.json` a mano — siempre se regenera con `npm run openapi:export`

## Cómo correr el proyecto

```bash
# Setup inicial
nvm use                          # usa Node 20
npm install                      # o pnpm install si el repo usa pnpm
cp .env.example .env             # llenar valores reales de Supabase
npm run db:generate              # genera el cliente Prisma

# Desarrollo
npm run dev                      # corre en watch mode con auto-reload
npm run db:studio                # abre Prisma Studio para inspeccionar la BD

# Validación pre-commit
npm run lint
npm run typecheck
npm run test
npm run openapi:export           # regenera openapi.json si cambiaron endpoints
```

### Aplicar migraciones a Supabase

Las migraciones viven en `infra/sql/` y se aplican manualmente desde el SQL Editor de Supabase Studio en orden numérico (001 → 006). El `schema.prisma` es la **fuente de verdad para tipos** del backend, pero las migraciones físicas las controla el SQL en `infra/sql/`.

## Decisiones ya tomadas (no re-discutir)

Si alguna parece mal, escribe un nuevo doc en `docs/DECISIONS/` proponiendo el cambio antes de modificar código:

- Repos separados (frontend y backend) — no monorepo
- NestJS para backend (no Express directo, no Fastify standalone)
- Prisma como ORM (no Drizzle, no TypeORM)
- Zod + nestjs-zod para validación (no class-validator)
- Supabase Auth nativo en Fase 1 (no Clerk, no Auth0, no propio)
- Vitest para unit tests (no Jest)
- Pino para logs (no Winston, no Bunyan)
- Schema `cfb` separado de `public` en Postgres
- Soft-delete solo en tablas críticas
- Permisología híbrida: rol + matriz de permisos editable
- OpenAPI como contrato compartido con el frontend (no GraphQL, no tRPC)

## Glosario

- **BNPL**: Buy Now Pay Later — el producto core de Cashea
- **BVC**: Bolsa de Valores de Caracas
- **CFB**: Certificado de Financiamiento Bursátil
- **Cuota / Installment**: la unidad de cash-flow que se securitiza
- **Lote / Batch**: archivo Excel semanal de órdenes que sube Tesorería
- **Pool**: conjunto de cuotas que respalda un certificado
- **Sweep / Barrido**: certificado del viernes que envuelve el remanente
- **Shortfall**: gap entre `nominal_target` y `nominal_actual`
- **SUNAVAL**: Superintendencia Nacional de Valores

---

*Última actualización: bootstrap inicial del backend.*
*Cuando agregues nuevas decisiones de arquitectura, actualiza este archivo.*
