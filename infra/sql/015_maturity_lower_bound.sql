-- 015_maturity_lower_bound.sql
-- Slice 1 / Maturity Bounds Bilateral — cierra el borde inferior de Rule 1.
-- Idempotente. Apply with: psql -f 015_maturity_lower_bound.sql o paste en Supabase SQL Editor.
-- Depends on: 003_portfolio.sql (cfb.orders, cfb.installments), 007_invariants_complete.sql
--             (cfb.enforce_maturity_boundary, trg_co_maturity_boundary).

BEGIN;

-- 1. ADD COLUMN min_due_date (nullable inicialmente para poder backfill)
ALTER TABLE cfb.orders
  ADD COLUMN IF NOT EXISTS min_due_date date;

-- 2. Backfill desde installments para órdenes existentes
UPDATE cfb.orders o
SET min_due_date = sub.min_due
FROM (
  SELECT order_id, MIN(due_date) AS min_due
    FROM cfb.installments
   GROUP BY order_id
) sub
WHERE o.id = sub.order_id
  AND o.min_due_date IS NULL;

-- 3. NOT NULL después del backfill
ALTER TABLE cfb.orders
  ALTER COLUMN min_due_date SET NOT NULL;

-- 4. Índice para la query de elegibilidad (status + min_due_date)
CREATE INDEX IF NOT EXISTS idx_orders_status_min_due
  ON cfb.orders USING btree (status, min_due_date);

-- 5. Extender el trigger de maturity boundary para chequear ambos bordes
CREATE OR REPLACE FUNCTION cfb.enforce_maturity_boundary() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_order_max_due  date;
  v_order_min_due  date;
  v_cert_maturity  date;
  v_cert_issue     date;
BEGIN
  SELECT max_due_date, min_due_date INTO v_order_max_due, v_order_min_due
    FROM cfb.orders WHERE id = NEW.order_id;
  SELECT maturity_date, issue_date INTO v_cert_maturity, v_cert_issue
    FROM cfb.certificates WHERE id = NEW.certificate_id;

  IF v_order_max_due IS NULL OR v_order_min_due IS NULL
     OR v_cert_maturity IS NULL OR v_cert_issue IS NULL THEN
    RAISE EXCEPTION 'Datos insuficientes para validar maturity boundary'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF v_order_max_due > v_cert_maturity THEN
    RAISE EXCEPTION
      'La cuota más tardía de la orden % vence (%) después del vencimiento del certificado % (%)',
      NEW.order_id, v_order_max_due, NEW.certificate_id, v_cert_maturity
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_order_min_due < v_cert_issue THEN
    RAISE EXCEPTION
      'La cuota más temprana de la orden % vence (%) antes del inicio del certificado % (%)',
      NEW.order_id, v_order_min_due, NEW.certificate_id, v_cert_issue
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- 6. Trigger ya existe (de 007). DROP + CREATE asegura que apunte a la nueva fn.
DROP TRIGGER IF EXISTS trg_co_maturity_boundary ON cfb.certificate_orders;
CREATE TRIGGER trg_co_maturity_boundary
  BEFORE INSERT OR UPDATE OF order_id, certificate_id ON cfb.certificate_orders
  FOR EACH ROW EXECUTE FUNCTION cfb.enforce_maturity_boundary();

COMMIT;
