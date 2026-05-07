-- 010_investors_updated_at.sql
-- Add updated_at and updated_by_id columns to cfb.investors so the frontend
-- can show "last edited at / by whom" without joining cfb.audit_log.
--
-- The audit_log remains the source of truth for full change history;
-- these columns are a denormalized convenience for read paths.
--
-- updated_at is set explicitly by the service on every UPDATE — no DB trigger.
-- For pre-existing rows, default to created_at so "last edited" is sensible
-- before any updates happen.
--
-- Idempotent — safe to re-run.
-- Depends on: 003_portfolio.sql (cfb.investors), 001_init.sql (cfb.users).

BEGIN;

ALTER TABLE cfb.investors
  ADD COLUMN IF NOT EXISTS updated_at  timestamptz,
  ADD COLUMN IF NOT EXISTS updated_by_id uuid;

UPDATE cfb.investors
SET updated_at    = COALESCE(updated_at, created_at),
    updated_by_id = COALESCE(updated_by_id, created_by_id);

ALTER TABLE cfb.investors
  ALTER COLUMN updated_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT now();

DO $$ BEGIN
  ALTER TABLE cfb.investors
    ADD CONSTRAINT investors_updated_by_id_fkey
      FOREIGN KEY (updated_by_id) REFERENCES cfb.users(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
