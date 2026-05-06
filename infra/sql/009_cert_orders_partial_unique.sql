-- 009_cert_orders_partial_unique.sql
-- Convert certificate_orders.order_id UNIQUE constraint to a partial unique
-- index so cancelled cert_orders rows (released_at IS NOT NULL) don't block
-- the order from being re-pooled in a new certificate.
--
-- The order indivisibility rule (one active assignment per order) is preserved
-- by the partial index's WHERE clause.
--
-- Idempotent — safe to re-run.
-- Depends on: 004_issuance.sql (cfb.certificate_orders).

BEGIN;

ALTER TABLE cfb.certificate_orders
  DROP CONSTRAINT IF EXISTS certificate_orders_order_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_co_active_order_id
  ON cfb.certificate_orders (order_id)
  WHERE released_at IS NULL;

COMMIT;
