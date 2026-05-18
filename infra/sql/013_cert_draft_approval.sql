-- 013_cert_draft_approval.sql
-- Slice 13: certificate draft → approval workflow
--
-- Changes:
--   1. Add 'reserved' to cfb.order_status enum (between available and assigned)
--   2. Add certificate.approve permission and grant to admin
--   3. Make certificate_code nullable (set during approval, not creation)
--   4. Replace unconditional UNIQUE on certificate_code with partial unique index
--      (only enforced when code is non-null)
--   5. Add approval / cancellation tracking columns to cfb.certificates
--   6. Schedule a pg_cron job that auto-cancels draft certificates >24h old
--
-- Idempotent: IF NOT EXISTS / IF EXISTS / ON CONFLICT DO NOTHING throughout.
-- Depends on: 001_init.sql, 004_issuance.sql, 005_rls_policies.sql, 006_seeds.sql.

BEGIN;

-- ============================================================
-- 1. Add 'reserved' to cfb.order_status
-- ============================================================
-- ALTER TYPE … ADD VALUE cannot run inside a transaction on PG < 12,
-- but Supabase (PG 15+) supports it.  Using a DO block for idempotency.
DO $$ BEGIN
  ALTER TYPE cfb.order_status ADD VALUE IF NOT EXISTS 'reserved' BEFORE 'assigned';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 2. Permission catalog
-- ============================================================
INSERT INTO cfb.permissions (key, description) VALUES
  ('certificate.approve', 'Aprobar un certificado en borrador para emitirlo')
ON CONFLICT (key) DO NOTHING;

INSERT INTO cfb.role_permissions (role, permission_id, granted_by_id)
SELECT 'admin'::cfb.user_role, p.id, NULL
FROM cfb.permissions p
WHERE p.key = 'certificate.approve'
ON CONFLICT DO NOTHING;

-- ============================================================
-- 3. cfb.certificates schema changes
-- ============================================================

-- Make certificate_code nullable (it is assigned at approval time)
ALTER TABLE cfb.certificates
  ALTER COLUMN certificate_code DROP NOT NULL;

-- Default new certificates to 'draft' status
ALTER TABLE cfb.certificates
  ALTER COLUMN status SET DEFAULT 'draft'::cfb.certificate_status;

-- Approval tracking
ALTER TABLE cfb.certificates
  ADD COLUMN IF NOT EXISTS approved_by_id      uuid REFERENCES cfb.users(id),
  ADD COLUMN IF NOT EXISTS approved_at         timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at        timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_reason text;

-- ============================================================
-- 4. Partial unique index on certificate_code
-- ============================================================
-- Drop the old unconditional constraint/index if it exists.
-- The constraint may be named differently depending on migration history;
-- try both names for safety.
ALTER TABLE cfb.certificates
  DROP CONSTRAINT IF EXISTS certificates_certificate_code_key;

DROP INDEX IF EXISTS cfb.certificates_certificate_code_key;
DROP INDEX IF EXISTS cfb.certificates_code_unique;

CREATE UNIQUE INDEX IF NOT EXISTS certificates_code_unique
  ON cfb.certificates (certificate_code)
  WHERE certificate_code IS NOT NULL;

-- ============================================================
-- 5. pg_cron TTL job — auto-cancel drafts older than 24 hours
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Unschedule first to stay idempotent on re-runs
SELECT cron.unschedule('cfb-draft-ttl-cancel')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'cfb-draft-ttl-cancel'
);

SELECT cron.schedule(
  'cfb-draft-ttl-cancel',
  '*/15 * * * *',
  $$
  WITH expired AS (
    SELECT id
    FROM cfb.certificates
    WHERE status = 'draft'
      AND created_at < NOW() - INTERVAL '24 hours'
  ),
  cancelled_certs AS (
    UPDATE cfb.certificates
    SET
      status               = 'cancelled',
      cancelled_at         = NOW(),
      cancellation_reason  = 'Auto-cancelado: TTL 24h sin aprobación'
    WHERE id IN (SELECT id FROM expired)
    RETURNING id
  ),
  released_orders AS (
    UPDATE cfb.orders
    SET status = 'available'
    FROM cfb.certificate_orders co
    WHERE co.order_id          = cfb.orders.id
      AND co.certificate_id IN (SELECT id FROM cancelled_certs)
      AND cfb.orders.status    = 'reserved'
    RETURNING cfb.orders.id
  )
  UPDATE cfb.certificate_orders
  SET
    released_at     = NOW(),
    released_reason = 'auto_cancel_ttl_24h'
  WHERE certificate_id IN (SELECT id FROM cancelled_certs)
    AND released_at IS NULL;
  $$
);

COMMIT;
