-- 004_issuance.sql
-- Slice 0 / Foundation — issuance-domain tables: investors, certificate_sequence,
-- certificates, certificate_orders, certificate_events.
-- Idempotent. Apply with: psql -f 004_issuance.sql or paste into Supabase SQL Editor.
-- Depends on: 001_init.sql (cfb schema, enums, cfb.users, cfb.prevent_mutation,
--             cfb.current_user_id),
--             003_portfolio.sql (cfb.orders).

-- ------------------------------------------------------------
-- KNOWN DIVERGENCES FROM IDEAL STATE (preserved for byte-equivalence)
-- ------------------------------------------------------------
-- 1) investors.created_by_id and certificates.deleted_by_id have ON DELETE NO ACTION
--    (the live FK delete_rule is NO ACTION, not SET NULL). The live state is reproduced
--    faithfully here; a follow-up migration can change the rule if desired.
-- 2) certificates.investor_id has ON DELETE NO ACTION (not RESTRICT). Both behave the
--    same within a transaction; the distinction is only in deferred FK checks. The live
--    state is reproduced as-is.
-- ------------------------------------------------------------

BEGIN;

-- ============================================================
-- ISSUANCE TABLES
-- Dependency order: investors
--                   certificate_sequence
--                   certificates → certificate_orders
--                                → certificate_events
-- ============================================================

-- cfb.investors
-- One row per investor (juridica, natural, or internal/Cashea itself).
-- rif must be globally unique. Only one investor may have kind = 'internal'
-- (enforced by partial unique index uq_investors_one_internal).
CREATE TABLE IF NOT EXISTS cfb.investors (
  id            uuid                   NOT NULL DEFAULT gen_random_uuid(),
  legal_name    character varying(255) NOT NULL,
  rif           character varying(15)  NOT NULL,
  kind          cfb.investor_kind      NOT NULL DEFAULT 'juridica'::cfb.investor_kind,
  status        cfb.investor_status    NOT NULL DEFAULT 'active'::cfb.investor_status,
  email         character varying(255),
  phone         character varying(30),
  notes         text,
  created_at    timestamptz            NOT NULL DEFAULT now(),
  created_by_id uuid,
  CONSTRAINT investors_pkey PRIMARY KEY (id),
  CONSTRAINT investors_rif_key UNIQUE (rif),
  CONSTRAINT investors_created_by_id_fkey
    FOREIGN KEY (created_by_id) REFERENCES cfb.users(id)
);

-- Enforce at most one investor with kind = 'internal' (Cashea sweep buyer).
CREATE UNIQUE INDEX IF NOT EXISTS uq_investors_one_internal
  ON cfb.investors USING btree (kind)
  WHERE (kind = 'internal'::cfb.investor_kind);

CREATE INDEX IF NOT EXISTS idx_investors_name
  ON cfb.investors USING btree (legal_name);

CREATE INDEX IF NOT EXISTS idx_investors_status
  ON cfb.investors USING btree (status);

-- cfb.certificate_sequence
-- Singleton row (id = 1) that holds the current position of the certificate
-- code generator. The function cfb.next_certificate_code() atomically
-- increments current_number and returns the formatted code.
-- Starting values reproduce the live state (current_number = 4571, letter = 'A'),
-- meaning the first generated code will be C4572A.
CREATE TABLE IF NOT EXISTS cfb.certificate_sequence (
  id             integer                NOT NULL DEFAULT 1,
  current_number integer                NOT NULL DEFAULT 4571,
  current_letter character varying(1)   NOT NULL DEFAULT 'A'::character varying,
  updated_at     timestamptz            NOT NULL DEFAULT now(),
  CONSTRAINT certificate_sequence_pkey PRIMARY KEY (id),
  CONSTRAINT certificate_sequence_id_check CHECK ((id = 1))
);

-- cfb.certificates
-- One row per CFB issued. Soft-delete via deleted_at / deleted_by_id.
-- status starts as 'issued' on creation (no 'draft' workflow yet).
-- Rule 2 (order indivisibility): enforced by UNIQUE (order_id) on certificate_orders.
-- Rule 3 (round-down): enforced by CHECK (nominal_actual <= nominal_target).
-- One sweep per weekly cycle: enforced by partial unique index uq_certs_one_sweep_per_cycle.
CREATE TABLE IF NOT EXISTS cfb.certificates (
  id                uuid                    NOT NULL DEFAULT gen_random_uuid(),
  certificate_code  character varying(20)   NOT NULL,
  certificate_type  cfb.certificate_type    NOT NULL DEFAULT 'standard'::cfb.certificate_type,
  status            cfb.certificate_status  NOT NULL DEFAULT 'issued'::cfb.certificate_status,
  investor_id       uuid                    NOT NULL,
  investor_capital  numeric(18, 4)          NOT NULL,
  annual_rate       numeric(7, 6)           NOT NULL,
  rate_basis        character varying(20)   NOT NULL DEFAULT 'ACT/360'::character varying,
  term_days         integer                 NOT NULL,
  price             numeric(10, 8)          NOT NULL,
  nominal_target    numeric(18, 4)          NOT NULL,
  nominal_actual    numeric(18, 4)          NOT NULL,
  investor_paid     numeric(18, 4)          NOT NULL,
  investor_returned numeric(18, 4)          NOT NULL,
  investor_yield    numeric(18, 4)          NOT NULL,
  shortfall_pct     numeric(7, 6)           NOT NULL,
  issue_date        date                    NOT NULL,
  maturity_date     date                    NOT NULL,
  matured_at        timestamptz,
  cycle_week        character varying(8)    NOT NULL,
  payload_hash      character varying(64)   NOT NULL,
  issued_by_id      uuid                    NOT NULL,
  created_at        timestamptz             NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  deleted_by_id     uuid,
  deleted_reason    text,
  CONSTRAINT certificates_pkey PRIMARY KEY (id),
  CONSTRAINT certificates_certificate_code_key UNIQUE (certificate_code),
  -- Rule 3 (round-down): pool total cannot exceed nominal target.
  CONSTRAINT certificates_check CHECK ((nominal_actual <= nominal_target)),
  -- Capital identity with epsilon tolerance of 0.01.
  CONSTRAINT certificates_check1 CHECK (
    (((investor_paid + investor_returned) = investor_capital) OR
     (abs(((investor_paid + investor_returned) - investor_capital)) < 0.01))
  ),
  -- Yield identity with epsilon tolerance of 0.01.
  CONSTRAINT certificates_check2 CHECK (
    ((investor_yield = (nominal_actual - investor_paid)) OR
     (abs((investor_yield - (nominal_actual - investor_paid))) < 0.01))
  ),
  -- Maturity must be after issue.
  CONSTRAINT certificates_check3 CHECK ((maturity_date > issue_date)),
  -- Annual rate: [0, 1).
  CONSTRAINT certificates_annual_rate_check CHECK (
    ((annual_rate >= (0)::numeric) AND (annual_rate < (1)::numeric))
  ),
  -- Price: (0, 1].
  CONSTRAINT certificates_price_check CHECK (
    ((price > (0)::numeric) AND (price <= (1)::numeric))
  ),
  -- Investor capital must be positive.
  CONSTRAINT certificates_investor_capital_check CHECK ((investor_capital > (0)::numeric)),
  -- Product rule: only 14-day or 42-day tenors.
  CONSTRAINT certificates_term_days_check CHECK ((term_days = ANY (ARRAY[14, 42]))),
  CONSTRAINT certificates_investor_id_fkey
    FOREIGN KEY (investor_id) REFERENCES cfb.investors(id),
  CONSTRAINT certificates_issued_by_id_fkey
    FOREIGN KEY (issued_by_id) REFERENCES cfb.users(id),
  CONSTRAINT certificates_deleted_by_id_fkey
    FOREIGN KEY (deleted_by_id) REFERENCES cfb.users(id)
);

-- Partial unique: only one sweep certificate per calendar week (ISO YYYY-Www format).
CREATE UNIQUE INDEX IF NOT EXISTS uq_certs_one_sweep_per_cycle
  ON cfb.certificates USING btree (cycle_week)
  WHERE ((certificate_type = 'sweep'::cfb.certificate_type) AND (deleted_at IS NULL));

-- Partial index for status queries (exclude soft-deleted rows).
CREATE INDEX IF NOT EXISTS idx_certs_status
  ON cfb.certificates USING btree (status)
  WHERE (deleted_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_certs_cycle
  ON cfb.certificates USING btree (cycle_week);

CREATE INDEX IF NOT EXISTS idx_certs_investor
  ON cfb.certificates USING btree (investor_id);

CREATE INDEX IF NOT EXISTS idx_certs_issue_date
  ON cfb.certificates USING btree (issue_date DESC);

CREATE INDEX IF NOT EXISTS idx_certs_issued_by
  ON cfb.certificates USING btree (issued_by_id);

CREATE INDEX IF NOT EXISTS idx_certs_maturity
  ON cfb.certificates USING btree (maturity_date);

CREATE INDEX IF NOT EXISTS idx_certs_type_cycle
  ON cfb.certificates USING btree (certificate_type, cycle_week);

-- cfb.certificate_orders
-- Junction table linking certificates to their constituent orders.
-- Rule 2 (order indivisibility): UNIQUE (order_id) prevents an order from
-- appearing in more than one certificate simultaneously.
-- released_at / released_reason are set when an order is removed from the pool.
CREATE TABLE IF NOT EXISTS cfb.certificate_orders (
  id                        uuid          NOT NULL DEFAULT gen_random_uuid(),
  certificate_id            uuid          NOT NULL,
  order_id                  uuid          NOT NULL,
  installments_sum_snapshot numeric(18, 4) NOT NULL,
  assigned_at               timestamptz   NOT NULL DEFAULT now(),
  assigned_by_id            uuid          NOT NULL,
  released_at               timestamptz,
  released_reason           text,
  CONSTRAINT certificate_orders_pkey PRIMARY KEY (id),
  -- Rule 2 blindaje: one order can only belong to one certificate at a time.
  CONSTRAINT certificate_orders_order_id_key UNIQUE (order_id),
  CONSTRAINT certificate_orders_certificate_id_fkey
    FOREIGN KEY (certificate_id) REFERENCES cfb.certificates(id),
  CONSTRAINT certificate_orders_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES cfb.orders(id),
  CONSTRAINT certificate_orders_assigned_by_id_fkey
    FOREIGN KEY (assigned_by_id) REFERENCES cfb.users(id)
);

CREATE INDEX IF NOT EXISTS idx_co_cert
  ON cfb.certificate_orders USING btree (certificate_id);

CREATE INDEX IF NOT EXISTS idx_co_assigned_at
  ON cfb.certificate_orders USING btree (assigned_at DESC);

-- cfb.certificate_events
-- Immutable event log for certificates. INSERT-only (enforced by trigger).
-- actor_id is nullable to support system-generated events.
CREATE TABLE IF NOT EXISTS cfb.certificate_events (
  id             uuid                   NOT NULL DEFAULT gen_random_uuid(),
  certificate_id uuid                   NOT NULL,
  event_type     character varying(50)  NOT NULL,
  payload        jsonb                  NOT NULL DEFAULT '{}'::jsonb,
  actor_id       uuid,
  occurred_at    timestamptz            NOT NULL DEFAULT now(),
  CONSTRAINT certificate_events_pkey PRIMARY KEY (id),
  CONSTRAINT certificate_events_certificate_id_fkey
    FOREIGN KEY (certificate_id) REFERENCES cfb.certificates(id),
  CONSTRAINT certificate_events_actor_id_fkey
    FOREIGN KEY (actor_id) REFERENCES cfb.users(id)
);

CREATE INDEX IF NOT EXISTS idx_cert_events_cert
  ON cfb.certificate_events USING btree (certificate_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_cert_events_type
  ON cfb.certificate_events USING btree (event_type);

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Returns the next certificate code (e.g. C4572A) by atomically incrementing
-- the singleton row in cfb.certificate_sequence.
-- The sequence starts at current_number = 4571 / letter = 'A', so the first
-- call returns C4572A — continuing the live series from C4572A onward.
CREATE OR REPLACE FUNCTION cfb.next_certificate_code()
  RETURNS character varying
  LANGUAGE plpgsql
AS $function$
DECLARE
    v_number INT;
    v_letter VARCHAR(1);
BEGIN
    UPDATE cfb.certificate_sequence
    SET current_number = current_number + 1, updated_at = NOW()
    WHERE id = 1
    RETURNING current_number, current_letter INTO v_number, v_letter;

    RETURN 'C' || v_number::TEXT || v_letter;
END;
$function$;

-- Logs a status_changed event to certificate_events whenever certificates.status changes.
-- Called by trg_certs_status_log (AFTER UPDATE OF status ON cfb.certificates).
CREATE OR REPLACE FUNCTION cfb.log_certificate_status_change()
  RETURNS trigger
  LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        INSERT INTO cfb.certificate_events (certificate_id, event_type, payload, actor_id)
        VALUES (
            NEW.id,
            'status_changed',
            jsonb_build_object('from', OLD.status, 'to', NEW.status),
            cfb.current_user_id()
        );
    END IF;
    RETURN NEW;
END;
$function$;

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Enforce certificate_events immutability: block UPDATE and DELETE.
DROP TRIGGER IF EXISTS trg_cert_events_immutable ON cfb.certificate_events;
CREATE TRIGGER trg_cert_events_immutable
  BEFORE DELETE OR UPDATE ON cfb.certificate_events
  FOR EACH ROW EXECUTE FUNCTION cfb.prevent_mutation();

-- Log certificate status transitions to the certificate_events table.
-- Column-specific: only fires when the status column changes.
DROP TRIGGER IF EXISTS trg_certs_status_log ON cfb.certificates;
CREATE TRIGGER trg_certs_status_log
  AFTER UPDATE OF status ON cfb.certificates
  FOR EACH ROW EXECUTE FUNCTION cfb.log_certificate_status_change();

COMMIT;
