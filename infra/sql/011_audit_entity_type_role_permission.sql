-- 011_audit_entity_type_role_permission.sql
-- Adds 'role_permission' value to the cfb.audit_entity_type enum so that
-- Slice 5c grant/revoke audit rows can use a dedicated entity_type instead
-- of the generic 'system'. This unlocks future audit queries:
--   GET /api/audit?entity_type=role_permission
--
-- Postgres ALTER TYPE ... ADD VALUE is idempotent in spirit but has no
-- IF NOT EXISTS form pre-PG 9.6. Wrap in DO/EXCEPTION to make it re-runnable.
--
-- Depends on: 001_init.sql (cfb.audit_entity_type enum, cfb.audit_log table).

BEGIN;

DO $$ BEGIN
  ALTER TYPE cfb.audit_entity_type ADD VALUE 'role_permission';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
