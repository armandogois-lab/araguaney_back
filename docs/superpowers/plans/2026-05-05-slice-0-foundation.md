# Slice 0 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile the bootstrap repo with the Supabase DB that already has the 19 `cfb.*` tables migrated, close the maturity-boundary invariant gap (Rule 1), and stand up the NestJS foundation (env, Prisma, Pino, healthcheck, OpenAPI export, tests) so that Slices 1+ can add domain endpoints on a stable base.

**Architecture:** SQL files in `infra/sql/` are written by extracting the live state from Supabase (single source of truth), grouped by domain in dependency order (`001_init` → `007_invariants_complete`), idempotent, wrapped in transactions. The Prisma schema is introspected via `prisma db pull` against `DIRECT_URL`, then refined to follow project conventions (PascalCase models, snake_case fields, no field-level `@map`, partial indexes deleted from the schema since Prisma can't represent `WHERE`). The NestJS layer is wired with `nestjs-pino`, `nestjs-zod`, global filter for error translation, public `/api/health` endpoint, and a Swagger export script.

**Tech Stack:** Node 20, NestJS 10, TypeScript 5 strict, Prisma 5 (multiSchema), Zod + nestjs-zod, Pino + nestjs-pino, Vitest, pnpm. DB: Supabase Postgres 17 (project `esobivqsddwrbxlytfsn`, schema `cfb`). MCP tools used during implementation: `mcp__plugin_supabase_supabase__execute_sql`, `mcp__plugin_supabase_supabase__list_tables`, `mcp__plugin_supabase_supabase__apply_migration`.

---

## Spec reference

This plan implements `docs/superpowers/specs/2026-05-05-slice-0-foundation-design.md`. Read that first.

## File structure (what will be created or modified)

```
infra/sql/
  001_init.sql                  CREATE: schema, extensions, 10 enums, 6 transversal tables
                                        (users, permissions, role_permissions, audit_log,
                                         settings, documents), 5 helper functions,
                                        prevent_mutation trigger on audit_log
  002_ingestion.sql             CREATE: excel_uploads, batches, import_errors
  003_portfolio.sql             CREATE: merchants, merchant_name_history, end_users, orders,
                                        order_events, installments, installment_events
                                        + 2 functions + 4 triggers
  004_issuance.sql              CREATE: investors, certificate_sequence, certificates,
                                        certificate_orders, certificate_events
                                        + 2 functions + 2 triggers + partial unique indexes
  005_rls_policies.sql          CREATE: ENABLE RLS + ~50 policies on all 19 tables
  006_seeds.sql                 INSERT: permissions (20), role_permissions (40),
                                        Cashea internal investor, certificate_sequence,
                                        settings (with values currently in Supabase)
  007_invariants_complete.sql   CREATE: enforce_maturity_boundary function +
                                        trg_co_maturity_boundary trigger on certificate_orders

prisma/
  schema.prisma                 REWRITE: full schema with multiSchema, 19 models, 10 enums

src/
  config/
    env.config.ts               CREATE: Zod schema + loader for env vars
    env.config.test.ts          CREATE: unit tests for env validation
  prisma/
    prisma.service.ts           REWRITE: real PrismaService (extends PrismaClient)
    prisma.module.ts            MODIFY: @Global() module exposing PrismaService
  common/
    filters/
      all-exceptions.filter.ts  CREATE: global error filter (Spanish to client, English to logs)
    pipes/
      zod-validation.pipe.ts    CREATE: Zod-based validation pipe
  modules/
    health/
      health.module.ts          CREATE
      health.controller.ts      CREATE: GET /api/health
      health.service.ts         CREATE: SELECT 1 against Prisma
      health.controller.test.ts CREATE: unit tests with mocked Prisma
  app.module.ts                 REWRITE: ConfigModule + LoggerModule + PrismaModule + HealthModule
  main.ts                       REWRITE: bootstrap with Pino, helmet, CORS, Swagger, prefix /api

scripts/
  export-openapi.ts             REWRITE: generate openapi.json without listening on port

.env.example                    REWRITE: full set of required env vars
package.json                    MODIFY: add scripts (dev, build, test, openapi:export, db:*)
openapi.json                    GENERATE + COMMIT (root, gitignored by default — force-add)
```

---

## Reference queries (used throughout Phase A)

These are the exact queries the engineer runs via `mcp__plugin_supabase_supabase__execute_sql` (project `esobivqsddwrbxlytfsn`) to extract DDL data.

```sql
-- COLUMNS for a table (inputs: $TABLE)
SELECT
  column_name, ordinal_position, column_default, is_nullable,
  data_type, character_maximum_length, numeric_precision, numeric_scale,
  udt_schema || '.' || udt_name AS udt_full
FROM information_schema.columns
WHERE table_schema = 'cfb' AND table_name = '$TABLE'
ORDER BY ordinal_position;

-- FKs for the schema
SELECT
  tc.table_name, tc.constraint_name, kcu.column_name,
  ccu.table_schema AS f_schema, ccu.table_name AS f_table, ccu.column_name AS f_column,
  rc.update_rule, rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'cfb'
ORDER BY tc.table_name, kcu.ordinal_position;

-- FUNCTIONS (full DDL)
SELECT p.proname, pg_get_functiondef(p.oid) AS ddl
FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'cfb' ORDER BY p.proname;

-- TRIGGERS (full DDL)
SELECT c.relname AS table_name, t.tgname, pg_get_triggerdef(t.oid, true) AS ddl
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'cfb' AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;

-- INDEXES (full DDL — already idempotent-friendly because they show CREATE [UNIQUE] INDEX)
SELECT tablename, indexname, indexdef
FROM pg_indexes WHERE schemaname = 'cfb' ORDER BY tablename, indexname;
```

The tool `mcp__plugin_supabase_supabase__list_tables` with `verbose=true, schemas=["cfb"]` is also useful for a quick column overview — use both in tandem.

---

# Phase A — Versioning the SQL state

## Task 1: Skeleton + transversal tables in `001_init.sql`

**Files:**
- Create: `infra/sql/001_init.sql`

- [ ] **Step 1: Pull column defs for the 6 transversal tables**

Run via `mcp__plugin_supabase_supabase__execute_sql`, one query per table — `users`, `permissions`, `role_permissions`, `audit_log`, `settings`, `documents`. Use the COLUMNS query from the reference block. Save outputs in scratch.

- [ ] **Step 2: Pull function DDL for the 5 helpers**

Filter the FUNCTIONS query result for: `current_user_id`, `current_user_role`, `has_permission`, `is_admin`, `is_authenticated_user`, `prevent_mutation`. Capture the full `pg_get_functiondef` output verbatim — these become the `CREATE OR REPLACE FUNCTION` blocks.

- [ ] **Step 3: Write the file**

Create `infra/sql/001_init.sql` with this skeleton, filled in with the data from steps 1-2:

```sql
-- 001_init.sql
-- Slice 0 / Foundation — schema, extensions, enums, transversal tables, helpers.
-- Idempotent. Apply with: psql -f 001_init.sql or paste into Supabase SQL Editor.
-- Depends on: nothing.

BEGIN;

CREATE SCHEMA IF NOT EXISTS cfb;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

-- ENUMS (PG 17 doesn't support IF NOT EXISTS for CREATE TYPE)
DO $$ BEGIN
  CREATE TYPE cfb.user_role AS ENUM ('operator', 'admin', 'auditor');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE cfb.audit_entity_type AS ENUM (
    'batch','order','installment','certificate','certificate_order',
    'investor','merchant','end_user','user','setting','system'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ... (8 more DO blocks for batch_status, certificate_status, certificate_type,
--      document_kind, installment_status, investor_kind, investor_status, order_status)

-- TABLES (transversal)
CREATE TABLE IF NOT EXISTS cfb.users (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id    uuid        UNIQUE,                -- FK to auth.users(id), declared below
  email           text        NOT NULL UNIQUE,
  full_name       text        NOT NULL,
  role            cfb.user_role NOT NULL,
  is_active       boolean     NOT NULL DEFAULT true,
  last_login_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Defer the auth.users FK because that schema is owned by Supabase
ALTER TABLE cfb.users
  DROP CONSTRAINT IF EXISTS users_auth_user_id_fkey,
  ADD CONSTRAINT users_auth_user_id_fkey
    FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ... (repeat the CREATE TABLE IF NOT EXISTS pattern for permissions, role_permissions,
--      audit_log, settings, documents — fields and FKs from extraction step 1)

-- FUNCTIONS (paste verbatim from pg_get_functiondef output)
CREATE OR REPLACE FUNCTION cfb.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT id FROM cfb.users WHERE auth_user_id = auth.uid()
$$;

-- ... (4 more CREATE OR REPLACE FUNCTION blocks: current_user_role, has_permission,
--      is_admin, is_authenticated_user, prevent_mutation)

-- TRIGGER on audit_log
DROP TRIGGER IF EXISTS trg_audit_log_immutable ON cfb.audit_log;
CREATE TRIGGER trg_audit_log_immutable
  BEFORE UPDATE OR DELETE ON cfb.audit_log
  FOR EACH ROW EXECUTE FUNCTION cfb.prevent_mutation();

COMMIT;
```

Replace each `-- ...` ellipsis with the actual extracted content. Do NOT leave any ellipsis or comment that says "more here" — it must be runnable.

- [ ] **Step 4: Verify idempotency by static inspection**

Re-read the file. Every `CREATE` must be `CREATE ... IF NOT EXISTS` or guarded by a `DO ... EXCEPTION` block (for enums) or `CREATE OR REPLACE` (for functions). Every `CREATE TRIGGER` must be preceded by `DROP TRIGGER IF EXISTS`. No bare `CREATE TYPE`.

- [ ] **Step 5: Verify byte-equivalence vs Supabase**

For each transversal table, compare your `CREATE TABLE` against `mcp__plugin_supabase_supabase__list_tables({schemas:["cfb"], verbose:true})` output. Column count, names, types, NOT NULL must match exactly. For enums, compare values list. For functions, compare against extracted `pg_get_functiondef`.

- [ ] **Step 6: Commit**

```bash
git add infra/sql/001_init.sql
git commit -m "feat(infra): add 001_init.sql with schema, enums, transversal tables

Versions the existing Supabase schema for cfb.users, permissions,
role_permissions, audit_log, settings, documents plus the helper
functions has_permission/current_user_id/etc. and the audit_log
immutability trigger. Idempotent."
```

---

## Task 2: `002_ingestion.sql`

**Files:**
- Create: `infra/sql/002_ingestion.sql`

- [ ] **Step 1: Extract column defs for `excel_uploads`, `batches`, `import_errors`**

Use the COLUMNS query for each. Capture `column_default`, `is_nullable`, types.

- [ ] **Step 2: Extract FKs filtering `tc.table_name IN ('excel_uploads','batches','import_errors')`**

Use the FKs query. Note `ON DELETE`/`ON UPDATE` rules.

- [ ] **Step 3: Extract indexes**

From the INDEXES query, filter for these 3 tables. Capture `idx_batches_imported_at`, `idx_batches_status`, `idx_excel_uploads_hash`, `idx_excel_uploads_uploaded_at`, `idx_excel_uploads_user`, `idx_import_errors_batch`, `idx_import_errors_code`.

- [ ] **Step 4: Write the file**

```sql
-- 002_ingestion.sql
-- Slice 0 / Foundation — ingestion domain (excel uploads, batches, import errors).
-- Depends on: 001_init.sql (FKs to cfb.users).

BEGIN;

CREATE TABLE IF NOT EXISTS cfb.excel_uploads (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  filename           text        NOT NULL,
  storage_path       text        NOT NULL,
  storage_bucket     text        NOT NULL,
  content_hash       text        NOT NULL,
  file_size_bytes    bigint      NOT NULL,
  mime_type          text        NOT NULL,
  uploaded_at        timestamptz NOT NULL DEFAULT now(),
  uploaded_by_id     uuid        NOT NULL REFERENCES cfb.users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_excel_uploads_hash
  ON cfb.excel_uploads (content_hash);
CREATE INDEX IF NOT EXISTS idx_excel_uploads_uploaded_at
  ON cfb.excel_uploads (uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_excel_uploads_user
  ON cfb.excel_uploads (uploaded_by_id);

-- ... (CREATE TABLE for batches with its FK to excel_uploads + status enum +
--      counters + indexes idx_batches_imported_at, idx_batches_status)
-- ... (CREATE TABLE for import_errors with FK to batches + indexes
--      idx_import_errors_batch, idx_import_errors_code)

COMMIT;
```

Fill in `batches` and `import_errors` with extracted data — do not leave ellipses.

- [ ] **Step 5: Verify byte-equivalence**

Compare every column and FK against `list_tables verbose=true`. The unique constraints `batches_excel_upload_id_key` and `batches_external_code_key` must appear inline as `UNIQUE` or as `CREATE UNIQUE INDEX`.

- [ ] **Step 6: Commit**

```bash
git add infra/sql/002_ingestion.sql
git commit -m "feat(infra): add 002_ingestion.sql (excel_uploads, batches, import_errors)"
```

---

## Task 3: `003_portfolio.sql`

**Files:**
- Create: `infra/sql/003_portfolio.sql`

- [ ] **Step 1: Extract columns for the 7 portfolio tables**

Tables: `merchants`, `merchant_name_history`, `end_users`, `orders`, `order_events`, `installments`, `installment_events`. Run COLUMNS query for each.

- [ ] **Step 2: Extract FKs filtered to those 7 tables**

Note: `orders` has FKs to `batches`, `merchants`, `end_users`. `installments` has FK to `orders`. `merchant_name_history` has FK to `merchants` and (optional) `batches`.

- [ ] **Step 3: Extract function DDL for `log_order_status_change` and `touch_merchant_last_seen`**

From the FUNCTIONS query.

- [ ] **Step 4: Extract indexes for these tables (including partials)**

Specifically capture:
- `idx_orders_eligibility` (partial WHERE `status = 'available'`)
- `idx_end_users_national_id` (partial WHERE `national_id IS NOT NULL`)
- `uq_mnh_one_current_per_merchant` (partial unique WHERE `effective_to IS NULL`)
- All non-partial indexes: `idx_orders_batch`, `idx_orders_merchant`, etc.

- [ ] **Step 5: Write the file**

```sql
-- 003_portfolio.sql
-- Slice 0 / Foundation — portfolio domain.
-- Depends on: 001_init.sql (FKs to cfb.users), 002_ingestion.sql (FKs to cfb.batches).

BEGIN;

CREATE TABLE IF NOT EXISTS cfb.merchants (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  rif             text        NOT NULL UNIQUE,
  current_name    text        NOT NULL,
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now()
);

-- ... (CREATE TABLE for merchant_name_history with FK to merchants + partial unique
--      index uq_mnh_one_current_per_merchant)
-- ... (CREATE TABLE for end_users with partial index idx_end_users_national_id)
-- ... (CREATE TABLE for orders — note num_installments CHECK 1..3, num_installments enum, FKs)
-- ... (CREATE TABLE for order_events — jsonb payload, idx_order_events_order, idx_order_events_type)
-- ... (CREATE TABLE for installments — installment_number CHECK 1..3, idx_installments_due_status,
--      idx_installments_status, UNIQUE (order_id, installment_number))
-- ... (CREATE TABLE for installment_events — idx_installment_events_inst, idx_installment_events_type)

-- Partial unique index (cannot be expressed as inline UNIQUE)
CREATE UNIQUE INDEX IF NOT EXISTS uq_mnh_one_current_per_merchant
  ON cfb.merchant_name_history (merchant_id) WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_eligibility
  ON cfb.orders (status, max_due_date) WHERE status = 'available';

CREATE INDEX IF NOT EXISTS idx_end_users_national_id
  ON cfb.end_users (national_id) WHERE national_id IS NOT NULL;

-- FUNCTIONS
CREATE OR REPLACE FUNCTION cfb.log_order_status_change() RETURNS trigger
  LANGUAGE plpgsql AS $$ /* paste body from pg_get_functiondef */ $$;

CREATE OR REPLACE FUNCTION cfb.touch_merchant_last_seen() RETURNS trigger
  LANGUAGE plpgsql AS $$ /* paste body from pg_get_functiondef */ $$;

-- TRIGGERS
DROP TRIGGER IF EXISTS trg_order_events_immutable ON cfb.order_events;
CREATE TRIGGER trg_order_events_immutable
  BEFORE UPDATE OR DELETE ON cfb.order_events
  FOR EACH ROW EXECUTE FUNCTION cfb.prevent_mutation();

DROP TRIGGER IF EXISTS trg_installment_events_immutable ON cfb.installment_events;
CREATE TRIGGER trg_installment_events_immutable
  BEFORE UPDATE OR DELETE ON cfb.installment_events
  FOR EACH ROW EXECUTE FUNCTION cfb.prevent_mutation();

DROP TRIGGER IF EXISTS trg_orders_status_log ON cfb.orders;
CREATE TRIGGER trg_orders_status_log
  AFTER UPDATE ON cfb.orders
  FOR EACH ROW EXECUTE FUNCTION cfb.log_order_status_change();

DROP TRIGGER IF EXISTS trg_orders_touch_seen ON cfb.orders;
CREATE TRIGGER trg_orders_touch_seen
  AFTER INSERT ON cfb.orders
  FOR EACH ROW EXECUTE FUNCTION cfb.touch_merchant_last_seen();

COMMIT;
```

- [ ] **Step 6: Verify byte-equivalence**

For each table, run a full column diff against `list_tables verbose=true`. For partial indexes, verify the WHERE clause matches exactly (including spacing variations — `WHERE (status = 'available'::cfb.order_status)` is what `pg_indexes` shows; you may write `WHERE status = 'available'` and Postgres will normalize on apply).

- [ ] **Step 7: Commit**

```bash
git add infra/sql/003_portfolio.sql
git commit -m "feat(infra): add 003_portfolio.sql (merchants, orders, installments, events)"
```

---

## Task 4: `004_issuance.sql`

**Files:**
- Create: `infra/sql/004_issuance.sql`

- [ ] **Step 1: Extract columns + checks for `investors`, `certificate_sequence`, `certificates`, `certificate_orders`, `certificate_events`**

Use COLUMNS query. Pay special attention to `certificates` — it has 9 CHECK constraints (round-down, capital identity, yield identity, term_days IN (14,42), maturity > issue, annual_rate range, price range, investor_capital > 0). All these were captured in the audit.

- [ ] **Step 2: Extract function DDL for `log_certificate_status_change` and `next_certificate_code`**

- [ ] **Step 3: Extract the partial unique indexes**

Specifically: `uq_certs_one_sweep_per_cycle` (partial WHERE `certificate_type = 'sweep' AND deleted_at IS NULL`), `uq_investors_one_internal` (partial WHERE `kind = 'internal'`), and the partial `idx_certs_status` (WHERE `deleted_at IS NULL`).

- [ ] **Step 4: Write the file**

```sql
-- 004_issuance.sql
-- Slice 0 / Foundation — issuance domain.
-- Depends on: 001_init.sql (cfb.users), 003_portfolio.sql (cfb.orders).

BEGIN;

CREATE TABLE IF NOT EXISTS cfb.investors (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name      text        NOT NULL,
  rif             text        NOT NULL UNIQUE,
  kind            cfb.investor_kind NOT NULL,
  status          cfb.investor_status NOT NULL DEFAULT 'active',
  contact_email   text,
  contact_phone   text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by_id   uuid        REFERENCES cfb.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_investors_name ON cfb.investors (legal_name);
CREATE INDEX IF NOT EXISTS idx_investors_status ON cfb.investors (status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_investors_one_internal
  ON cfb.investors (kind) WHERE kind = 'internal';

CREATE TABLE IF NOT EXISTS cfb.certificate_sequence (
  id              integer     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  current_number  integer     NOT NULL,
  current_letter  char(1)     NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cfb.certificates (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  certificate_code    text        NOT NULL UNIQUE,
  certificate_type    cfb.certificate_type NOT NULL,
  status              cfb.certificate_status NOT NULL,
  investor_id         uuid        NOT NULL REFERENCES cfb.investors(id) ON DELETE RESTRICT,
  investor_capital    numeric(18,4) NOT NULL CHECK (investor_capital > 0),
  annual_rate         numeric(7,6)  NOT NULL CHECK (annual_rate >= 0 AND annual_rate < 1),
  rate_basis          text        NOT NULL DEFAULT '360',
  term_days           integer     NOT NULL CHECK (term_days = ANY (ARRAY[14, 42])),
  price               numeric(7,6)  NOT NULL CHECK (price > 0 AND price <= 1),
  nominal_target      numeric(18,4) NOT NULL,
  nominal_actual      numeric(18,4) NOT NULL DEFAULT 0,
  investor_paid       numeric(18,4) NOT NULL DEFAULT 0,
  investor_returned   numeric(18,4) NOT NULL DEFAULT 0,
  investor_yield      numeric(18,4) NOT NULL DEFAULT 0,
  shortfall_pct       numeric(7,6)  NOT NULL DEFAULT 0,
  issue_date          date        NOT NULL,
  maturity_date       date        NOT NULL,
  cancelled_at        timestamptz,
  cycle_week          date        NOT NULL,
  payload_hash        text        NOT NULL,
  issued_by_id        uuid        NOT NULL REFERENCES cfb.users(id) ON DELETE RESTRICT,
  created_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  deleted_by_id       uuid        REFERENCES cfb.users(id) ON DELETE SET NULL,

  CHECK (nominal_actual <= nominal_target),
  CHECK ((investor_paid + investor_returned) = investor_capital
         OR abs((investor_paid + investor_returned) - investor_capital) < 0.01),
  CHECK (investor_yield = (nominal_actual - investor_paid)
         OR abs(investor_yield - (nominal_actual - investor_paid)) < 0.01),
  CHECK (maturity_date > issue_date)
);

CREATE INDEX IF NOT EXISTS idx_certs_cycle ON cfb.certificates (cycle_week);
CREATE INDEX IF NOT EXISTS idx_certs_investor ON cfb.certificates (investor_id);
CREATE INDEX IF NOT EXISTS idx_certs_issue_date ON cfb.certificates (issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_certs_issued_by ON cfb.certificates (issued_by_id);
CREATE INDEX IF NOT EXISTS idx_certs_maturity ON cfb.certificates (maturity_date);
CREATE INDEX IF NOT EXISTS idx_certs_status
  ON cfb.certificates (status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_certs_type_cycle
  ON cfb.certificates (certificate_type, cycle_week);
CREATE UNIQUE INDEX IF NOT EXISTS uq_certs_one_sweep_per_cycle
  ON cfb.certificates (cycle_week)
  WHERE certificate_type = 'sweep' AND deleted_at IS NULL;

-- ... (CREATE TABLE for certificate_orders — UNIQUE(order_id) here is the order indivisibility
--      blindaje)
-- ... (CREATE TABLE for certificate_events — jsonb payload, prevent_mutation trigger below)

-- FUNCTIONS
CREATE OR REPLACE FUNCTION cfb.next_certificate_code() RETURNS varchar
  LANGUAGE plpgsql AS $$ /* paste body */ $$;

CREATE OR REPLACE FUNCTION cfb.log_certificate_status_change() RETURNS trigger
  LANGUAGE plpgsql AS $$ /* paste body */ $$;

-- TRIGGERS
DROP TRIGGER IF EXISTS trg_cert_events_immutable ON cfb.certificate_events;
CREATE TRIGGER trg_cert_events_immutable
  BEFORE UPDATE OR DELETE ON cfb.certificate_events
  FOR EACH ROW EXECUTE FUNCTION cfb.prevent_mutation();

DROP TRIGGER IF EXISTS trg_certs_status_log ON cfb.certificates;
CREATE TRIGGER trg_certs_status_log
  AFTER UPDATE ON cfb.certificates
  FOR EACH ROW EXECUTE FUNCTION cfb.log_certificate_status_change();

COMMIT;
```

- [ ] **Step 5: Verify byte-equivalence**

Critical: the 9 `CHECK` constraints on `certificates` must all be present. Cross-check against the audit data captured in the spec (Section 2). The partial indexes `uq_certs_one_sweep_per_cycle` and `uq_investors_one_internal` are non-negotiable — Rules 2 and "one sweep per cycle" depend on them.

- [ ] **Step 6: Commit**

```bash
git add infra/sql/004_issuance.sql
git commit -m "feat(infra): add 004_issuance.sql (investors, certificates, partial unique blindajes)"
```

---

## Task 5: `005_rls_policies.sql`

**Files:**
- Create: `infra/sql/005_rls_policies.sql`

- [ ] **Step 1: Extract every policy from the live DB**

```sql
SELECT
  schemaname, tablename, policyname, cmd, permissive,
  array_to_string(roles, ',') AS roles,
  qual, with_check
FROM pg_policies
WHERE schemaname = 'cfb'
ORDER BY tablename, policyname;
```

You already captured this once in the audit. Re-run to confirm nothing has changed.

- [ ] **Step 2: Write the file**

For each of the 19 tables: `ALTER TABLE cfb.<t> ENABLE ROW LEVEL SECURITY;`. Then for each policy: `DROP POLICY IF EXISTS <name> ON cfb.<t>;` followed by the `CREATE POLICY` reconstructed from `qual` and `with_check`. Pattern:

```sql
-- 005_rls_policies.sql
-- Slice 0 / Foundation — Row Level Security policies.
-- Depends on: 001_init.sql..004_issuance.sql (all tables must exist).

BEGIN;

ALTER TABLE cfb.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfb.permissions ENABLE ROW LEVEL SECURITY;
-- ... (17 more tables)

-- Per-table: drop-and-recreate every policy
DROP POLICY IF EXISTS users_admin_all ON cfb.users;
CREATE POLICY users_admin_all ON cfb.users
  AS PERMISSIVE FOR ALL TO authenticated
  USING (cfb.has_permission('user.manage'))
  WITH CHECK (cfb.has_permission('user.manage'));

DROP POLICY IF EXISTS users_read ON cfb.users;
CREATE POLICY users_read ON cfb.users
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (cfb.is_authenticated_user());

DROP POLICY IF EXISTS users_self_update ON cfb.users;
CREATE POLICY users_self_update ON cfb.users
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

-- ... (repeat for all ~50 policies captured in pg_policies)

COMMIT;
```

The exact list of policies to recreate is in the audit data captured during the spec phase. Reproduce each one literally — do not rewrite expressions.

- [ ] **Step 3: Verify count**

```sql
SELECT count(*) FROM pg_policies WHERE schemaname = 'cfb';
```

Count the `CREATE POLICY` statements in your file. They must match.

- [ ] **Step 4: Commit**

```bash
git add infra/sql/005_rls_policies.sql
git commit -m "feat(infra): add 005_rls_policies.sql (RLS + ~50 policies for cfb schema)"
```

---

## Task 6: `006_seeds.sql`

**Files:**
- Create: `infra/sql/006_seeds.sql`

- [ ] **Step 1: Pull the actual seed data from Supabase**

Run via execute_sql:

```sql
SELECT key, description FROM cfb.permissions ORDER BY key;
SELECT role, permission_id FROM cfb.role_permissions ORDER BY role, permission_id;
SELECT id, legal_name, rif, kind, status, contact_email, contact_phone FROM cfb.investors;
SELECT id, current_number, current_letter FROM cfb.certificate_sequence;
SELECT id, shortfall_warning_threshold, concentration_warning_threshold, default_sweep_rate FROM cfb.settings;
```

For permissions/role_permissions: capture the 20 + 40 rows. Note that `role_permissions.permission_id` is a UUID — you'll re-derive it from the seeded `permissions` (insert by key, then look up the UUID).

- [ ] **Step 2: Write the file**

```sql
-- 006_seeds.sql
-- Slice 0 / Foundation — initial seeds.
-- Depends on: 001_init.sql..004_issuance.sql.
-- Idempotent via ON CONFLICT DO NOTHING.

BEGIN;

-- Permissions (20 rows from current Supabase state)
INSERT INTO cfb.permissions (key, description) VALUES
  ('audit.read',          'Leer registros del audit log'),
  ('batch.read',           'Leer batches y errores de importación'),
  ('batch.upload',         'Subir archivos Excel y crear batches'),
  -- ... 17 more rows, one per row from the SELECT above
  ('user.manage',          'Crear, editar y desactivar usuarios')
ON CONFLICT (key) DO NOTHING;

-- Role-permission matrix (40 rows). Look up permission_id by key to keep the seed
-- portable across regenerations.
INSERT INTO cfb.role_permissions (role, permission_id)
SELECT v.role::cfb.user_role, p.id
FROM (VALUES
  ('admin',    'audit.read'),
  ('admin',    'batch.read'),
  -- ... 38 more (role, key) pairs from current state
  ('operator', 'portfolio.write')
) AS v(role, key)
JOIN cfb.permissions p ON p.key = v.key
ON CONFLICT (role, permission_id) DO NOTHING;

-- Cashea internal investor (the partial unique uq_investors_one_internal protects against duplicates)
INSERT INTO cfb.investors (legal_name, rif, kind, status)
VALUES ('Cashea (internal)', 'J-XXXXXXXXX', 'internal', 'active')
ON CONFLICT DO NOTHING;

-- Certificate sequence — values pulled from current Supabase state
INSERT INTO cfb.certificate_sequence (id, current_number, current_letter)
VALUES (1, $CURRENT_NUMBER$, '$CURRENT_LETTER$')
ON CONFLICT (id) DO NOTHING;

-- Settings — values pulled from current Supabase state
INSERT INTO cfb.settings (id, shortfall_warning_threshold, concentration_warning_threshold, default_sweep_rate)
VALUES (1, $SWT$, $CWT$, $DSR$)
ON CONFLICT (id) DO NOTHING;

COMMIT;
```

Replace every `$VAR$` placeholder and `-- ... N more rows` with the actual extracted data. The file must be runnable as-is.

- [ ] **Step 3: Verify counts**

After the engineer fills in, count VALUES tuples vs the row counts from Supabase: 20 permissions, 40 role_permissions, 1 investor (with `kind='internal'`), 1 certificate_sequence row, 1 settings row.

- [ ] **Step 4: Commit**

```bash
git add infra/sql/006_seeds.sql
git commit -m "feat(infra): add 006_seeds.sql (permissions, role-matrix, internal investor, settings)"
```

---

## Task 7: `007_invariants_complete.sql` (the gap fix)

**Files:**
- Create: `infra/sql/007_invariants_complete.sql`

- [ ] **Step 1: Pre-check that no live data would violate the new constraint**

Run via execute_sql:

```sql
SELECT count(*) AS would_violate
FROM cfb.certificate_orders co
JOIN cfb.orders o      ON o.id = co.order_id
JOIN cfb.certificates c ON c.id = co.certificate_id
WHERE o.max_due_date > c.maturity_date;
```

Expected: `0`. If non-zero, abort and report — the trigger would lock those rows out of mutation. (Currently `certificate_orders` has 0 rows so this is a formality, but always check before adding constraints.)

- [ ] **Step 2: Write the file**

```sql
-- 007_invariants_complete.sql
-- Slice 0 / Foundation — closes the maturity-boundary blindaje (Rule 1).
-- Depends on: 003_portfolio.sql (cfb.orders.max_due_date), 004_issuance.sql (cfb.certificates.maturity_date,
--             cfb.certificate_orders).

BEGIN;

CREATE OR REPLACE FUNCTION cfb.enforce_maturity_boundary() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_order_max_due  date;
  v_cert_maturity  date;
BEGIN
  SELECT max_due_date INTO v_order_max_due
    FROM cfb.orders WHERE id = NEW.order_id;
  SELECT maturity_date INTO v_cert_maturity
    FROM cfb.certificates WHERE id = NEW.certificate_id;

  IF v_order_max_due IS NULL OR v_cert_maturity IS NULL THEN
    RAISE EXCEPTION 'Datos insuficientes para validar maturity boundary'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF v_order_max_due > v_cert_maturity THEN
    RAISE EXCEPTION
      'La cuota más tardía de la orden % vence (%) después del vencimiento del certificado % (%)',
      NEW.order_id, v_order_max_due, NEW.certificate_id, v_cert_maturity
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_co_maturity_boundary ON cfb.certificate_orders;
CREATE TRIGGER trg_co_maturity_boundary
  BEFORE INSERT OR UPDATE OF order_id, certificate_id ON cfb.certificate_orders
  FOR EACH ROW EXECUTE FUNCTION cfb.enforce_maturity_boundary();

COMMIT;
```

- [ ] **Step 3: Apply via Supabase MCP**

Run `mcp__plugin_supabase_supabase__apply_migration` with:
- `name`: `slice0_invariants_complete`
- `query`: the body of the file (without `BEGIN;`/`COMMIT;` — `apply_migration` runs in its own transaction)

Wait for success.

- [ ] **Step 4: Verify the trigger is active**

```sql
SELECT t.tgname, c.relname
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
WHERE t.tgname = 'trg_co_maturity_boundary';
```

Expected: 1 row showing `trg_co_maturity_boundary` on `certificate_orders`.

- [ ] **Step 5: Commit**

```bash
git add infra/sql/007_invariants_complete.sql
git commit -m "feat(infra): add 007_invariants_complete.sql closing maturity boundary (Rule 1)

Adds enforce_maturity_boundary() function + BEFORE INSERT/UPDATE
trigger on cfb.certificate_orders. Aligns DB state with the
3 hard rules promised in CLAUDE.md.

Applied to Supabase project esobivqsddwrbxlytfsn."
```

---

## Task 8: Cross-file end-of-phase verification

**Files:** none changed in this task.

- [ ] **Step 1: Count primitives**

Run via execute_sql:

```sql
SELECT
  (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'cfb') AS tables,
  (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid
     WHERE n.nspname = 'cfb' AND t.typtype = 'e') AS enums,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
     WHERE n.nspname = 'cfb') AS functions,
  (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'cfb' AND NOT t.tgisinternal) AS triggers,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'cfb') AS policies;
```

Expected after Task 7 applied: 19 tables, 10 enums, 11 functions (the 10 already there + `enforce_maturity_boundary`), 8 triggers (7 + `trg_co_maturity_boundary`), ~50 policies.

- [ ] **Step 2: Sanity-check the SQL file count**

```bash
ls infra/sql/*.sql | wc -l
```

Expected: `7`.

- [ ] **Step 3: No further commit**

This task is verification only — nothing to commit unless step 1 reveals a discrepancy, in which case identify the missing piece and add a follow-up commit fixing the relevant file.

---

# Phase B — Prisma synchronization

## Task 9: Configure `prisma/schema.prisma` datasource and generator

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Replace the placeholder schema**

Overwrite the 12-line placeholder with:

```prisma
generator client {
  provider        = "prisma-client-js"
  output          = "../node_modules/.prisma/client"
  previewFeatures = ["multiSchema"]
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
  schemas   = ["cfb"]
}
```

- [ ] **Step 2: Add a temp `.env` with real DB URLs**

If not already present, create `.env` (gitignored) with the actual `DATABASE_URL` (Supabase pooler, port 6543) and `DIRECT_URL` (Supabase direct, port 5432). The user can copy these from `.env.example` once it's expanded in Task 13. For now, ask the operator to provide them.

- [ ] **Step 3: Verify Prisma can connect**

```bash
pnpm prisma validate
```

Expected: `The schema at prisma/schema.prisma is valid 🚀`.

- [ ] **Step 4: No commit yet**

Wait until after Task 10 fills the schema with models.

---

## Task 10: Run `db pull` and refine the introspected schema

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Run introspection**

```bash
pnpm prisma db pull
```

Expected: ~600-800 lines added to `schema.prisma` — 19 `model` blocks + 10 `enum` blocks. Read the output for warnings about unsupported features (partial indexes will be flagged).

- [ ] **Step 2: Apply naming conventions**

For every `model`:
- Rename to PascalCase singular (`orders` → `Order`, `certificate_orders` → `CertificateOrder`, etc.).
- Add `@@map("<original_table_name>")` to preserve the DB name.
- Add `@@schema("cfb")`.
- Field names: leave as-is (snake_case from the DB) — do NOT add `@map` per field. This is the deviation from CLAUDE.md agreed in the spec.

For every `enum`:
- Rename to PascalCase (`user_role` → `UserRole`).
- Add `@@map("user_role") @@schema("cfb")`.

- [ ] **Step 3: Update relations to use the renamed model names**

After renaming, fields like `users User @relation(fields: [user_id], references: [id])` will be wired correctly. Check each `@relation` and confirm.

- [ ] **Step 4: Strip partial indexes that Prisma can't represent**

Search the schema for any `@@index([...])` that the engineer recognizes as a partial index from the spec (`uq_certs_one_sweep_per_cycle`, `uq_investors_one_internal`, `uq_mnh_one_current_per_merchant`, `idx_certs_status` partial, `idx_orders_eligibility` partial, `idx_end_users_national_id` partial).

These will appear as regular `@@index([cycle_week])` etc. in Prisma — **delete them**. The DB-level partial indexes already enforce the constraint; we don't want Prisma to see a non-partial copy that would be incorrect if it tried to create one.

Add a comment block at the top of the schema noting which indexes are SQL-only:

```prisma
// Indexes deliberately not represented in this schema (DB-only, partial WHERE clauses):
//   - uq_certs_one_sweep_per_cycle
//   - uq_investors_one_internal
//   - uq_mnh_one_current_per_merchant
//   - idx_certs_status (partial WHERE deleted_at IS NULL)
//   - idx_orders_eligibility (partial WHERE status = 'available')
//   - idx_end_users_national_id (partial WHERE national_id IS NOT NULL)
// They live in infra/sql/003_portfolio.sql and 004_issuance.sql.
```

- [ ] **Step 5: Manually fix `users.auth_user_id`**

`db pull` may try to add a relation to `auth.users` (the Supabase Auth table). Since `auth` is not in the `schemas` array, Prisma will likely emit a warning and leave the field as `String? @db.Uuid` without a relation. Confirm that's the case. If not, manually strip any `@relation` to an unmapped model.

- [ ] **Step 6: Generate the client**

```bash
pnpm prisma generate
```

Expected: `Generated Prisma Client (X.Y.Z) to ./node_modules/.prisma/client`. No warnings about unsupported features (the partial indexes are gone).

- [ ] **Step 7: Verify TypeScript compiles**

Create a temporary file `prisma/_check.ts`:

```typescript
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const c = await p.permission.count();
  console.log(c);
}
```

Run: `pnpm exec tsc --noEmit prisma/_check.ts`.

Expected: zero errors. Delete the file: `rm prisma/_check.ts`.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(prisma): introspect cfb schema, apply naming conventions

19 models + 10 enums introspected from Supabase via db pull.
Models: PascalCase + @@map/@@schema. Fields: snake_case (no @map).
Partial indexes deliberately excluded from schema — they live
in infra/sql/. multiSchema preview feature enabled."
```

---

# Phase C — NestJS foundation

## Task 11: Update `.env.example`

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Read the current `.env.example`**

```bash
cat .env.example
```

- [ ] **Step 2: Replace contents with full env list**

```dotenv
# Node
NODE_ENV=development
PORT=3000

# Supabase Postgres (https://supabase.com/dashboard → Project Settings → Database)
DATABASE_URL=postgresql://postgres.PROJECTREF:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
DIRECT_URL=postgresql://postgres.PROJECTREF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres

# Supabase Auth/Storage (https://supabase.com/dashboard → Project Settings → API)
SUPABASE_URL=https://PROJECTREF.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_JWT_SECRET=your-jwt-secret

# Logging
LOG_LEVEL=info

# CORS — comma-separated origins
CORS_ORIGINS=http://localhost:3001
```

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "feat(config): expand .env.example with full Slice 0 env vars"
```

---

## Task 12: Implement env validation (TDD)

**Files:**
- Create: `src/config/env.config.ts`
- Create: `src/config/env.config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/config/env.config.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { envSchema } from './env.config';

describe('envSchema', () => {
  const valid = {
    DATABASE_URL: 'postgresql://u:p@h:6543/db',
    DIRECT_URL: 'postgresql://u:p@h:5432/db',
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_ANON_KEY: 'a',
    SUPABASE_SERVICE_ROLE_KEY: 's',
    SUPABASE_JWT_SECRET: 'j',
  };

  it('parses a minimal valid env with defaults', () => {
    const r = envSchema.parse(valid);
    expect(r.NODE_ENV).toBe('development');
    expect(r.PORT).toBe(3000);
    expect(r.LOG_LEVEL).toBe('info');
    expect(r.CORS_ORIGINS).toEqual(['http://localhost:3001']);
  });

  it('rejects missing DATABASE_URL', () => {
    const { DATABASE_URL, ...bad } = valid;
    expect(() => envSchema.parse(bad)).toThrow();
  });

  it('rejects non-numeric PORT', () => {
    expect(() => envSchema.parse({ ...valid, PORT: 'abc' })).toThrow();
  });

  it('rejects unknown LOG_LEVEL', () => {
    expect(() => envSchema.parse({ ...valid, LOG_LEVEL: 'loud' })).toThrow();
  });

  it('parses CORS_ORIGINS as comma-separated list', () => {
    const r = envSchema.parse({ ...valid, CORS_ORIGINS: 'http://a, http://b ,http://c' });
    expect(r.CORS_ORIGINS).toEqual(['http://a', 'http://b', 'http://c']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm vitest run src/config/env.config.test.ts
```

Expected: FAIL — `Cannot find module './env.config'`.

- [ ] **Step 3: Implement `env.config.ts`**

Create `src/config/env.config.ts`:

```typescript
import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url(),

  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_JWT_SECRET: z.string().min(1),

  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3001')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): EnvConfig {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
```

- [ ] **Step 4: Run tests, expect pass**

```bash
pnpm vitest run src/config/env.config.test.ts
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/config/env.config.ts src/config/env.config.test.ts
git commit -m "feat(config): validate env vars with Zod"
```

---

## Task 13: Implement `PrismaService`

**Files:**
- Modify: `src/prisma/prisma.service.ts`
- Modify: `src/prisma/prisma.module.ts`

- [ ] **Step 1: Read current placeholder**

```bash
cat src/prisma/prisma.service.ts src/prisma/prisma.module.ts
```

- [ ] **Step 2: Rewrite `prisma.service.ts`**

```typescript
import { Injectable, OnModuleDestroy, OnModuleInit, INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Logger } from 'nestjs-pino';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly logger: Logger) {
    super({
      log: [
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
    });
    // @ts-expect-error — Prisma's overload for $on('error', ...) is acceptable here
    this.$on('error', (e) => this.logger.error({ err: e }, 'prisma error'));
    // @ts-expect-error — same
    this.$on('warn', (e) => this.logger.warn({ err: e }, 'prisma warning'));
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  enableShutdownHooks(app: INestApplication): void {
    process.on('beforeExit', async () => {
      await app.close();
    });
  }
}
```

- [ ] **Step 3: Rewrite `prisma.module.ts`**

```typescript
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

- [ ] **Step 4: Verify it compiles**

```bash
pnpm exec tsc --noEmit
```

Expected: zero errors. (If errors mention `nestjs-pino`, install it in Task 16 — re-run this check after.)

- [ ] **Step 5: Commit**

```bash
git add src/prisma/prisma.service.ts src/prisma/prisma.module.ts
git commit -m "feat(prisma): real PrismaService with Pino-bridged logging"
```

---

## Task 14: Configure Pino logger module

**Files:**
- Create: `src/common/logger/logger.module.ts`

- [ ] **Step 1: Confirm `nestjs-pino` and `pino-pretty` are dependencies**

```bash
cat package.json | grep -E "nestjs-pino|pino"
```

If missing:

```bash
pnpm add nestjs-pino pino pino-http
pnpm add -D pino-pretty
```

- [ ] **Step 2: Create the logger module**

```typescript
// src/common/logger/logger.module.ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import type { EnvConfig } from '../../config/env.config';

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvConfig, true>) => {
        const env = config.get('NODE_ENV', { infer: true });
        const level = config.get('LOG_LEVEL', { infer: true });
        return {
          pinoHttp: {
            level,
            transport:
              env === 'development'
                ? { target: 'pino-pretty', options: { singleLine: true, colorize: true } }
                : undefined,
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                '*.password',
                '*.SUPABASE_SERVICE_ROLE_KEY',
                '*.SUPABASE_JWT_SECRET',
              ],
              censor: '[REDACTED]',
            },
            genReqId: (req) =>
              (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
          },
        };
      },
    }),
  ],
  exports: [PinoLoggerModule],
})
export class LoggerModule {}
```

- [ ] **Step 3: Verify it compiles**

```bash
pnpm exec tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/common/logger/logger.module.ts package.json pnpm-lock.yaml
git commit -m "feat(logger): nestjs-pino with redaction and per-env transport"
```

---

## Task 15: Implement `AllExceptionsFilter`

**Files:**
- Create: `src/common/filters/all-exceptions.filter.ts`

- [ ] **Step 1: Create the filter**

```typescript
// src/common/filters/all-exceptions.filter.ts
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import type { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      this.logger.log(
        {
          method: request.method,
          url: request.url,
          status,
          body: typeof body === 'string' ? { message: body } : body,
        },
        'business exception',
      );
      response.status(status).json(typeof body === 'string' ? { statusCode: status, message: body } : body);
      return;
    }

    const err = exception instanceof Error ? exception : new Error(String(exception));
    this.logger.error(
      {
        method: request.method,
        url: request.url,
        err: { name: err.name, message: err.message, stack: err.stack },
      },
      'unhandled exception',
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Ocurrió un error inesperado',
    });
  }
}
```

- [ ] **Step 2: Verify compilation**

```bash
pnpm exec tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/common/filters/all-exceptions.filter.ts
git commit -m "feat(common): global filter — Spanish to client, English to logs"
```

---

## Task 16: Implement `ZodValidationPipe`

**Files:**
- Create: `src/common/pipes/zod-validation.pipe.ts`

- [ ] **Step 1: Confirm `nestjs-zod` and `zod` are dependencies**

```bash
cat package.json | grep -E "zod|nestjs-zod"
```

Install if missing:

```bash
pnpm add zod nestjs-zod
```

- [ ] **Step 2: Create the pipe**

We re-export `nestjs-zod`'s built-in pipe behind our own filename so we have a single place to extend it later (e.g., custom Spanish error messages).

```typescript
// src/common/pipes/zod-validation.pipe.ts
import { BadRequestException, Injectable, PipeTransform, ArgumentMetadata } from '@nestjs/common';
import { ZodError, ZodSchema } from 'zod';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema?: ZodSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    if (!this.schema) return value;
    try {
      return this.schema.parse(value);
    } catch (e) {
      if (e instanceof ZodError) {
        throw new BadRequestException({
          statusCode: 400,
          message: 'Datos de entrada inválidos',
          errors: e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
      }
      throw e;
    }
  }
}
```

- [ ] **Step 3: Verify compilation**

```bash
pnpm exec tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/common/pipes/zod-validation.pipe.ts package.json pnpm-lock.yaml
git commit -m "feat(common): ZodValidationPipe with Spanish error payload"
```

---

## Task 17: Implement Healthcheck (TDD)

**Files:**
- Create: `src/modules/health/health.module.ts`
- Create: `src/modules/health/health.controller.ts`
- Create: `src/modules/health/health.service.ts`
- Create: `src/modules/health/health.controller.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/modules/health/health.controller.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('HealthController', () => {
  let controller: HealthController;
  let prisma: { $queryRaw: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    prisma = { $queryRaw: vi.fn() };
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        HealthService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    controller = moduleRef.get(HealthController);
  });

  it('returns 200 with database ok when SELECT 1 succeeds', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    const result = await controller.health();
    expect(result.status).toBe('ok');
    expect(result.database.status).toBe('ok');
    expect(typeof result.database.latencyMs).toBe('number');
    expect(result.uptime).toBeGreaterThan(0);
  });

  it('throws 503 when SELECT 1 rejects', async () => {
    prisma.$queryRaw.mockRejectedValueOnce(new Error('connection refused'));
    await expect(controller.health()).rejects.toMatchObject({ status: 503 });
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

```bash
pnpm vitest run src/modules/health/health.controller.test.ts
```

Expected: FAIL — `Cannot find module './health.controller'`.

- [ ] **Step 3: Implement the service**

```typescript
// src/modules/health/health.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface DatabaseStatus {
  status: 'ok' | 'down';
  latencyMs: number;
}

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async checkDatabase(): Promise<DatabaseStatus> {
    const t = process.hrtime.bigint();
    await this.prisma.$queryRaw`SELECT 1`;
    const dtNs = process.hrtime.bigint() - t;
    return { status: 'ok', latencyMs: Number(dtNs) / 1_000_000 };
  }
}
```

- [ ] **Step 4: Implement the controller**

```typescript
// src/modules/health/health.controller.ts
import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service';

const VERSION = '0.1.0';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  async health() {
    let database;
    try {
      database = await this.health.checkDatabase();
    } catch {
      throw new HttpException(
        {
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          status: 'degraded',
          database: { status: 'down', latencyMs: 0 },
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return {
      status: 'ok' as const,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: VERSION,
      database,
    };
  }
}
```

- [ ] **Step 5: Implement the module**

```typescript
// src/modules/health/health.module.ts
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
```

- [ ] **Step 6: Run tests, expect pass**

```bash
pnpm vitest run src/modules/health/health.controller.test.ts
```

Expected: 2 passed.

- [ ] **Step 7: Commit**

```bash
git add src/modules/health
git commit -m "feat(health): GET /api/health with DB ping"
```

---

## Task 18: Wire `AppModule`

**Files:**
- Modify: `src/app.module.ts`

- [ ] **Step 1: Read current state**

```bash
cat src/app.module.ts
```

- [ ] **Step 2: Rewrite**

```typescript
// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from './common/logger/logger.module';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { validateEnv } from './config/env.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    LoggerModule,
    PrismaModule,
    HealthModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 3: Compile check**

```bash
pnpm exec tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/app.module.ts
git commit -m "feat(app): wire ConfigModule + LoggerModule + PrismaModule + HealthModule"
```

---

## Task 19: Implement `main.ts` bootstrap

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Confirm peer dependencies**

```bash
cat package.json | grep -E "helmet|@nestjs/swagger"
```

Install if missing:

```bash
pnpm add helmet @nestjs/swagger
```

- [ ] **Step 2: Rewrite `main.ts`**

```typescript
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import type { EnvConfig } from './config/env.config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const logger = app.get(Logger);
  app.useLogger(logger);

  const config = app.get(ConfigService<EnvConfig, true>);
  const port = config.get('PORT', { infer: true });
  const corsOrigins = config.get('CORS_ORIGINS', { infer: true });

  app.setGlobalPrefix('api');
  app.useGlobalFilters(new AllExceptionsFilter(logger));
  app.use(helmet());
  app.enableCors({ origin: corsOrigins, credentials: true });
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Cashea CFB API')
    .setDescription('Backend para emisión de Certificados de Financiamiento Bursátil')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(port);
  logger.log(`Listening on http://localhost:${port}/api (CORS: ${corsOrigins.join(', ')})`);
}

void bootstrap();
```

- [ ] **Step 3: Compile check**

```bash
pnpm exec tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/main.ts package.json pnpm-lock.yaml
git commit -m "feat(app): bootstrap with Pino, helmet, CORS, Swagger at /api/docs"
```

---

## Task 20: Implement `export-openapi.ts`

**Files:**
- Modify: `scripts/export-openapi.ts`

- [ ] **Step 1: Read current placeholder**

```bash
cat scripts/export-openapi.ts
```

- [ ] **Step 2: Rewrite**

```typescript
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from '../src/app.module';

async function exportOpenApi(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');

  const config = new DocumentBuilder()
    .setTitle('Cashea CFB API')
    .setDescription('Backend para emisión de Certificados de Financiamiento Bursátil')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);

  const outPath = join(process.cwd(), 'openapi.json');
  writeFileSync(outPath, JSON.stringify(document, null, 2) + '\n', 'utf8');
  // eslint-disable-next-line no-console
  console.log(`OpenAPI spec written to ${outPath}`);

  await app.close();
}

void exportOpenApi().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Compile check**

```bash
pnpm exec tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add scripts/export-openapi.ts
git commit -m "feat(scripts): export-openapi.ts writes openapi.json from Swagger"
```

---

## Task 21: Add npm scripts to `package.json`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Read current scripts**

```bash
node -e "console.log(JSON.stringify(require('./package.json').scripts, null, 2))"
```

- [ ] **Step 2: Add/update scripts**

In `package.json`, ensure the `scripts` block contains at minimum:

```json
{
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "start": "node dist/main.js",
    "lint": "eslint \"{src,scripts,test}/**/*.ts\" --fix",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "prisma generate",
    "db:pull": "prisma db pull",
    "db:studio": "prisma studio",
    "openapi:export": "tsx scripts/export-openapi.ts"
  }
}
```

If `tsx` isn't installed: `pnpm add -D tsx`.

- [ ] **Step 3: Verify scripts run**

```bash
pnpm typecheck
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(scripts): add dev/test/db/openapi scripts"
```

---

## Task 22: End-to-end smoke test

**Files:** none modified.

- [ ] **Step 1: Confirm `.env` has real values**

The local `.env` (not `.env.example`) must have `DATABASE_URL`, `DIRECT_URL`, and Supabase keys filled. Confirm by:

```bash
test -f .env && grep -E "^DATABASE_URL=postgresql" .env >/dev/null && echo "ok" || echo "missing"
```

If missing, ask the operator to fill it before continuing.

- [ ] **Step 2: Start the dev server in the background**

```bash
pnpm dev &
DEV_PID=$!
sleep 4
```

- [ ] **Step 3: Curl the healthcheck**

```bash
curl -s -w "\nHTTP %{http_code}\n" http://localhost:3000/api/health
```

Expected output (status 200):

```json
{
  "status": "ok",
  "timestamp": "2026-05-05T...",
  "uptime": ...,
  "version": "0.1.0",
  "database": { "status": "ok", "latencyMs": ... }
}
```

- [ ] **Step 4: Curl the Swagger spec**

```bash
curl -s http://localhost:3000/api/docs-json | head -40
```

Expected: a JSON document starting with `{"openapi":"3.0.0",...}` containing the `/api/health` path.

- [ ] **Step 5: Stop the dev server**

```bash
kill $DEV_PID
wait $DEV_PID 2>/dev/null
```

- [ ] **Step 6: Run the full test suite**

```bash
pnpm test
```

Expected: all tests pass (env.config.test.ts: 5 passed; health.controller.test.ts: 2 passed).

- [ ] **Step 7: No commit**

This task is verification only. If anything fails, go back and fix the relevant earlier task.

---

## Task 23: Generate and commit `openapi.json`

**Files:**
- Generate + Force-add: `openapi.json`

- [ ] **Step 1: Run the export**

```bash
pnpm openapi:export
```

Expected: prints `OpenAPI spec written to .../openapi.json`. File should contain `/api/health` path.

- [ ] **Step 2: Force-add (overrides .gitignore)**

```bash
git add -f openapi.json
git commit -m "feat(openapi): generate openapi.json for araguaney_front consumption"
```

(`openapi.json` is in `.gitignore` to prevent uncommitted local generation noise — but we explicitly commit the canonical version each time it changes. CLAUDE.md mandates this for the frontend's `openapi-typescript` consumption.)

- [ ] **Step 3: Optionally remove `openapi.json` from `.gitignore`**

If the team prefers tracking the file always (so any change is loud in git status), edit `.gitignore` to remove the line:

```
# Generated artifacts
openapi.json
```

If you change this, commit:

```bash
git add .gitignore
git commit -m "chore(git): track openapi.json (no longer ignored)"
```

This is a project-style choice, not a hard requirement.

---

## Self-review

(Performed during plan creation; record of verification.)

**1. Spec coverage:**

- Section 2 audit findings → captured in Task 1 step 5 (verify byte-equivalence) and Task 8 (cross-file count).
- Section 3 SQL extraction → Tasks 1-7.
- Section 4 Prisma sync → Tasks 9-10.
- Section 5 NestJS layer → Tasks 11-22.
- Spec section 6 decisions → reflected throughout (snake_case fields, no auth schema, healthcheck liviano, pnpm).
- Spec section 8 acceptance criteria → addressed by Tasks 8 (1-2), 10 step 6 (3), 22 (4-5), 22 step 6 (7), 23 (6), 21 step 3 (8), 11 (9). Criterion 10 (first commit) was satisfied before this plan was written.

**2. Placeholder scan:**

- All `-- ...` ellipses inside SQL files are explicitly described as "must be filled in with extracted data — do not leave ellipses". Each task has a verification step that surfaces gaps.
- `$VAR$` placeholders in `006_seeds.sql` are paired with explicit "replace every `$VAR$`" instructions.
- No "implement later" / "TBD" / "fill in details" anywhere.

**3. Type / name consistency:**

- `validateEnv` in Task 12 is referenced by `AppModule` in Task 18 — same name. ✅
- `AllExceptionsFilter` in Task 15 is imported by `main.ts` in Task 19. ✅
- `HealthService.checkDatabase` returns `DatabaseStatus` shape used by `HealthController.health` — matches. ✅
- `PrismaService` exported by `PrismaModule` (Task 13) is consumed by `HealthService` (Task 17). ✅
- `EnvConfig` type from Task 12 is used in Tasks 14, 19. ✅
- `Logger` from `nestjs-pino` is the exact symbol used in Tasks 13, 14, 15, 19. ✅

No issues found.

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-05-05-slice-0-foundation.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
