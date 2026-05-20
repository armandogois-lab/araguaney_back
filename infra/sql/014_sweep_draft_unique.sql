-- 014_sweep_draft_unique.sql
-- Slice 14: fix sweep cycle_week UNIQUE to exclude cancelled drafts
--
-- Background:
--   Migration 004 created uq_certs_one_sweep_per_cycle as a partial unique
--   index with WHERE certificate_type = 'sweep' AND deleted_at IS NULL.
--
--   Slice 13 (013_cert_draft_approval.sql) introduced a cancel() flow that
--   sets cancelled_at on draft certificates but leaves deleted_at NULL (drafts
--   are not soft-deleted, just cancelled). As a result, a cancelled sweep
--   draft keeps the weekly slot blocked forever, preventing any new sweep from
--   being created for the same cycle_week.
--
-- Fix:
--   Recreate the partial unique index also excluding rows where
--   status = 'cancelled'. This allows a new sweep draft to be created after
--   a previous one is cancelled (or auto-cancelled by the 24h TTL cron job).
--
-- Idempotent: DROP IF EXISTS + unconditional CREATE UNIQUE INDEX.
-- Depends on: 004_issuance.sql, 013_cert_draft_approval.sql.

BEGIN;

DROP INDEX IF EXISTS cfb.uq_certs_one_sweep_per_cycle;

CREATE UNIQUE INDEX uq_certs_one_sweep_per_cycle
  ON cfb.certificates (cycle_week)
  WHERE certificate_type = 'sweep'
    AND deleted_at IS NULL
    AND status <> 'cancelled';

COMMIT;
