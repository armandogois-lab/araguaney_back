-- 001_init.sql
-- Slice 0 / Foundation — schema, extensions, enums, transversal tables, helpers.
-- Idempotent. Apply with: psql -f 001_init.sql or paste into Supabase SQL Editor.
-- Depends on: nothing.

BEGIN;

-- ============================================================
-- SCHEMA & EXTENSIONS
-- ============================================================

CREATE SCHEMA IF NOT EXISTS cfb;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

-- ============================================================
-- ENUMS
-- PG 17 does not support IF NOT EXISTS for CREATE TYPE, so we
-- guard each with a DO block that ignores duplicate_object.
-- ============================================================

DO $$ BEGIN
  CREATE TYPE cfb.user_role AS ENUM ('operator', 'admin', 'auditor');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE cfb.audit_entity_type AS ENUM (
    'batch', 'order', 'installment', 'certificate', 'certificate_order',
    'investor', 'merchant', 'end_user', 'user', 'setting', 'system'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE cfb.batch_status AS ENUM (
    'uploaded', 'parsing', 'imported', 'rejected', 'archived'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE cfb.certificate_status AS ENUM (
    'draft', 'issued', 'matured', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE cfb.certificate_type AS ENUM (
    'standard', 'sweep'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE cfb.document_kind AS ENUM (
    'excel_upload', 'certificate_pdf', 'attachment'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE cfb.installment_status AS ENUM (
    'pending', 'due', 'paid', 'overdue'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE cfb.investor_kind AS ENUM (
    'juridica', 'natural', 'internal'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE cfb.investor_status AS ENUM (
    'active', 'inactive'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE cfb.order_status AS ENUM (
    'available', 'assigned', 'matured', 'defaulted'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- TRANSVERSAL TABLES
-- ============================================================

-- cfb.users
-- Internal application users (operators, admins, auditors).
-- Linked to Supabase Auth via auth_user_id.
CREATE TABLE IF NOT EXISTS cfb.users (
  id            uuid                NOT NULL DEFAULT gen_random_uuid(),
  email         character varying(255) NOT NULL,
  full_name     character varying(255) NOT NULL,
  role          cfb.user_role       NOT NULL DEFAULT 'operator'::cfb.user_role,
  is_active     boolean             NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz         NOT NULL DEFAULT now(),
  auth_user_id  uuid,
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_email_key UNIQUE (email),
  CONSTRAINT users_auth_user_id_key UNIQUE (auth_user_id)
);

-- The auth.users FK is declared separately because that schema is owned by Supabase.
-- The DROP/ADD pattern makes this block idempotent on re-runs.
ALTER TABLE cfb.users
  DROP CONSTRAINT IF EXISTS users_auth_user_id_fkey;
ALTER TABLE cfb.users
  ADD CONSTRAINT users_auth_user_id_fkey
    FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_auth
  ON cfb.users USING btree (auth_user_id);

CREATE INDEX IF NOT EXISTS idx_users_role_active
  ON cfb.users USING btree (role, is_active);

-- cfb.permissions
-- Granular permission keys (e.g. "certificate.issue").
CREATE TABLE IF NOT EXISTS cfb.permissions (
  id          uuid                   NOT NULL DEFAULT gen_random_uuid(),
  key         character varying(100) NOT NULL,
  description text                   NOT NULL,
  created_at  timestamptz            NOT NULL DEFAULT now(),
  CONSTRAINT permissions_pkey PRIMARY KEY (id),
  CONSTRAINT permissions_key_key UNIQUE (key)
);

CREATE INDEX IF NOT EXISTS idx_permissions_key
  ON cfb.permissions USING btree (key);

-- cfb.role_permissions
-- Matrix that maps roles to permissions. Editable in production without redeploy.
CREATE TABLE IF NOT EXISTS cfb.role_permissions (
  id            uuid          NOT NULL DEFAULT gen_random_uuid(),
  role          cfb.user_role NOT NULL,
  permission_id uuid          NOT NULL,
  granted_at    timestamptz   NOT NULL DEFAULT now(),
  granted_by_id uuid,
  CONSTRAINT role_permissions_pkey PRIMARY KEY (id),
  CONSTRAINT role_permissions_role_permission_id_key UNIQUE (role, permission_id),
  CONSTRAINT role_permissions_permission_id_fkey
    FOREIGN KEY (permission_id) REFERENCES cfb.permissions(id) ON DELETE CASCADE,
  CONSTRAINT role_permissions_granted_by_id_fkey
    FOREIGN KEY (granted_by_id) REFERENCES cfb.users(id)
);

CREATE INDEX IF NOT EXISTS idx_role_perms_role
  ON cfb.role_permissions USING btree (role);

CREATE INDEX IF NOT EXISTS idx_role_perms_perm
  ON cfb.role_permissions USING btree (permission_id);

-- cfb.audit_log
-- Append-only audit trail. Mutations blocked by trg_audit_log_immutable.
CREATE TABLE IF NOT EXISTS cfb.audit_log (
  id          uuid                    NOT NULL DEFAULT gen_random_uuid(),
  occurred_at timestamptz             NOT NULL DEFAULT now(),
  actor_id    uuid,
  action      character varying(100)  NOT NULL,
  entity_type cfb.audit_entity_type   NOT NULL,
  entity_id   character varying(50),
  ip_address  character varying(45),
  user_agent  text,
  payload     jsonb                   NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT audit_log_pkey PRIMARY KEY (id),
  CONSTRAINT audit_log_actor_id_fkey
    FOREIGN KEY (actor_id) REFERENCES cfb.users(id)
);

CREATE INDEX IF NOT EXISTS idx_audit_occurred
  ON cfb.audit_log USING btree (occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_actor
  ON cfb.audit_log USING btree (actor_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_entity
  ON cfb.audit_log USING btree (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_audit_action
  ON cfb.audit_log USING btree (action);

-- cfb.settings
-- Singleton row (id = 1) holding system-wide configuration thresholds.
CREATE TABLE IF NOT EXISTS cfb.settings (
  id                             integer       NOT NULL DEFAULT 1,
  shortfall_warning_threshold    numeric(7, 6) NOT NULL DEFAULT 0.005,
  concentration_warning_threshold numeric(7, 6) NOT NULL DEFAULT 0.15,
  default_sweep_rate             numeric(7, 6) NOT NULL DEFAULT 0.08,
  updated_at                     timestamptz   NOT NULL DEFAULT now(),
  updated_by_id                  uuid,
  CONSTRAINT settings_pkey PRIMARY KEY (id),
  CONSTRAINT settings_id_check CHECK (id = 1),
  CONSTRAINT settings_updated_by_id_fkey
    FOREIGN KEY (updated_by_id) REFERENCES cfb.users(id)
);

-- cfb.documents
-- File metadata for documents stored in Supabase Storage buckets.
CREATE TABLE IF NOT EXISTS cfb.documents (
  id             uuid                   NOT NULL DEFAULT gen_random_uuid(),
  kind           cfb.document_kind      NOT NULL,
  entity_type    character varying(50)  NOT NULL,
  entity_id      character varying(50)  NOT NULL,
  filename       character varying(255) NOT NULL,
  storage_path   character varying(500) NOT NULL,
  storage_bucket character varying(100) NOT NULL,
  content_hash   character varying(64)  NOT NULL,
  file_size_bytes bigint                NOT NULL,
  mime_type      character varying(100) NOT NULL,
  uploaded_at    timestamptz            NOT NULL DEFAULT now(),
  uploaded_by_id uuid                   NOT NULL,
  CONSTRAINT documents_pkey PRIMARY KEY (id),
  CONSTRAINT documents_uploaded_by_id_fkey
    FOREIGN KEY (uploaded_by_id) REFERENCES cfb.users(id)
);

CREATE INDEX IF NOT EXISTS idx_documents_entity
  ON cfb.documents USING btree (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_documents_kind
  ON cfb.documents USING btree (kind);

-- ============================================================
-- HELPER FUNCTIONS
-- Only the 6 functions that belong to this migration (001).
-- The 4 others (log_certificate_status_change, log_order_status_change,
-- next_certificate_code, touch_merchant_last_seen) belong to later migrations.
-- ============================================================

CREATE OR REPLACE FUNCTION cfb.current_user_id()
  RETURNS uuid
  LANGUAGE sql
  STABLE SECURITY DEFINER
  SET search_path TO 'public', 'cfb'
AS $function$
    SELECT id FROM cfb.users WHERE auth_user_id = auth.uid() AND is_active = TRUE LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION cfb.current_user_role()
  RETURNS cfb.user_role
  LANGUAGE sql
  STABLE SECURITY DEFINER
  SET search_path TO 'public', 'cfb'
AS $function$
    SELECT role FROM cfb.users WHERE auth_user_id = auth.uid() AND is_active = TRUE LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION cfb.has_permission(p_key character varying)
  RETURNS boolean
  LANGUAGE sql
  STABLE SECURITY DEFINER
  SET search_path TO 'public', 'cfb'
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM cfb.users u
        JOIN cfb.role_permissions rp ON rp.role = u.role
        JOIN cfb.permissions p ON p.id = rp.permission_id
        WHERE u.auth_user_id = auth.uid()
          AND u.is_active = TRUE
          AND p.key = p_key
    )
$function$;

CREATE OR REPLACE FUNCTION cfb.is_admin()
  RETURNS boolean
  LANGUAGE sql
  STABLE
AS $function$
    SELECT cfb.current_user_role() = 'admin'::cfb.user_role
$function$;

CREATE OR REPLACE FUNCTION cfb.is_authenticated_user()
  RETURNS boolean
  LANGUAGE sql
  STABLE
AS $function$
    SELECT cfb.current_user_role() IS NOT NULL
$function$;

CREATE OR REPLACE FUNCTION cfb.prevent_mutation()
  RETURNS trigger
  LANGUAGE plpgsql
AS $function$
BEGIN
    RAISE EXCEPTION 'Tabla inmutable: solo INSERT está permitido';
END;
$function$;

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Enforce audit_log immutability: block UPDATE and DELETE.
DROP TRIGGER IF EXISTS trg_audit_log_immutable ON cfb.audit_log;
CREATE TRIGGER trg_audit_log_immutable
  BEFORE UPDATE OR DELETE ON cfb.audit_log
  FOR EACH ROW EXECUTE FUNCTION cfb.prevent_mutation();

COMMIT;
