-- 007_invariants_complete.sql
-- Slice 0 / Foundation — closes the maturity-boundary blindaje (Rule 1).
-- Idempotent. Apply with: psql -f 007_invariants_complete.sql or paste into Supabase SQL Editor.
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
