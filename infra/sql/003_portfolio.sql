-- 003_portfolio.sql
-- Slice 0 / Foundation — portfolio-domain tables: merchants, merchant_name_history,
-- end_users, orders, order_events, installments, installment_events.
-- Idempotent. Apply with: psql -f 003_portfolio.sql or paste into Supabase SQL Editor.
-- Depends on: 001_init.sql (cfb schema, enums, cfb.users, cfb.prevent_mutation),
--             002_ingestion.sql (cfb.batches).

BEGIN;

-- ============================================================
-- PORTFOLIO TABLES
-- Dependency order: merchants → merchant_name_history
--                   end_users (no deps in this domain)
--                   orders → order_events
--                   installments → installment_events
-- ============================================================

-- cfb.merchants
-- One row per RIF (tax ID). current_name mirrors the most-recent
-- merchant_name_history record; last_seen_at is touched on every new order.
CREATE TABLE IF NOT EXISTS cfb.merchants (
  id           uuid                   NOT NULL DEFAULT gen_random_uuid(),
  rif          character varying(15)  NOT NULL,
  current_name character varying(255) NOT NULL,
  first_seen_at timestamptz           NOT NULL DEFAULT now(),
  last_seen_at  timestamptz           NOT NULL DEFAULT now(),
  CONSTRAINT merchants_pkey PRIMARY KEY (id),
  CONSTRAINT merchants_rif_key UNIQUE (rif)
);

CREATE INDEX IF NOT EXISTS idx_merchants_name
  ON cfb.merchants USING btree (current_name);

-- cfb.merchant_name_history
-- Append-only audit trail of merchant name changes.
-- Only one row may have effective_to IS NULL per merchant (partial unique index).
-- source_batch_id is nullable: SET NULL if the originating batch is deleted.
CREATE TABLE IF NOT EXISTS cfb.merchant_name_history (
  id             uuid                   NOT NULL DEFAULT gen_random_uuid(),
  merchant_id    uuid                   NOT NULL,
  name           character varying(255) NOT NULL,
  effective_from timestamptz            NOT NULL,
  effective_to   timestamptz,
  created_at     timestamptz            NOT NULL DEFAULT now(),
  source_batch_id uuid,
  CONSTRAINT merchant_name_history_pkey PRIMARY KEY (id),
  CONSTRAINT merchant_name_history_merchant_id_fkey
    FOREIGN KEY (merchant_id) REFERENCES cfb.merchants(id) ON DELETE CASCADE,
  CONSTRAINT merchant_name_history_source_batch_id_fkey
    FOREIGN KEY (source_batch_id) REFERENCES cfb.batches(id) ON DELETE SET NULL
);

-- Partial unique: at most one "current" (open-ended) name per merchant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mnh_one_current_per_merchant
  ON cfb.merchant_name_history USING btree (merchant_id)
  WHERE (effective_to IS NULL);

CREATE INDEX IF NOT EXISTS idx_mnh_merchant_from
  ON cfb.merchant_name_history USING btree (merchant_id, effective_from DESC);

CREATE INDEX IF NOT EXISTS idx_mnh_merchant_to
  ON cfb.merchant_name_history USING btree (merchant_id, effective_to);

-- cfb.end_users
-- BNPL end-consumers identified by a privacy-preserving external hash.
-- PII fields (full_name, national_id, email, phone) are optional and
-- populated only when enrichment data is available.
CREATE TABLE IF NOT EXISTS cfb.end_users (
  id            uuid                   NOT NULL DEFAULT gen_random_uuid(),
  external_hash character varying(100) NOT NULL,
  full_name     character varying(255),
  national_id   character varying(20),
  email         character varying(255),
  phone         character varying(30),
  enriched_at   timestamptz,
  first_seen_at timestamptz            NOT NULL DEFAULT now(),
  last_seen_at  timestamptz            NOT NULL DEFAULT now(),
  CONSTRAINT end_users_pkey PRIMARY KEY (id),
  CONSTRAINT end_users_external_hash_key UNIQUE (external_hash)
);

-- Partial index: only index rows that actually have a national_id.
CREATE INDEX IF NOT EXISTS idx_end_users_national_id
  ON cfb.end_users USING btree (national_id)
  WHERE (national_id IS NOT NULL);

-- cfb.orders
-- One row per BNPL purchase order imported from an Excel batch.
-- num_installments is constrained to 1–3 (product rule).
-- status starts as 'available' and transitions via triggers.
CREATE TABLE IF NOT EXISTS cfb.orders (
  id                 uuid                   NOT NULL DEFAULT gen_random_uuid(),
  external_order_id  character varying(50)  NOT NULL,
  batch_id           uuid                   NOT NULL,
  merchant_id        uuid                   NOT NULL,
  end_user_id        uuid                   NOT NULL,
  total_amount       numeric(18, 4)         NOT NULL,
  installments_sum   numeric(18, 4)         NOT NULL,
  num_installments   integer                NOT NULL,
  purchase_date      date                   NOT NULL,
  max_due_date       date                   NOT NULL,
  status             cfb.order_status       NOT NULL DEFAULT 'available'::cfb.order_status,
  imported_at        timestamptz            NOT NULL DEFAULT now(),
  CONSTRAINT orders_pkey PRIMARY KEY (id),
  CONSTRAINT orders_external_order_id_key UNIQUE (external_order_id),
  CONSTRAINT orders_num_installments_check CHECK (((num_installments >= 1) AND (num_installments <= 3))),
  CONSTRAINT orders_batch_id_fkey
    FOREIGN KEY (batch_id) REFERENCES cfb.batches(id),
  CONSTRAINT orders_merchant_id_fkey
    FOREIGN KEY (merchant_id) REFERENCES cfb.merchants(id),
  CONSTRAINT orders_end_user_id_fkey
    FOREIGN KEY (end_user_id) REFERENCES cfb.end_users(id)
);

-- Partial index for pool-building queries: only available orders with their due dates.
CREATE INDEX IF NOT EXISTS idx_orders_eligibility
  ON cfb.orders USING btree (status, max_due_date)
  WHERE (status = 'available'::cfb.order_status);

CREATE INDEX IF NOT EXISTS idx_orders_batch
  ON cfb.orders USING btree (batch_id);

CREATE INDEX IF NOT EXISTS idx_orders_merchant
  ON cfb.orders USING btree (merchant_id);

CREATE INDEX IF NOT EXISTS idx_orders_end_user
  ON cfb.orders USING btree (end_user_id);

CREATE INDEX IF NOT EXISTS idx_orders_purchase
  ON cfb.orders USING btree (purchase_date DESC);

-- cfb.order_events
-- Immutable event log for orders. INSERT-only (enforced by trigger).
CREATE TABLE IF NOT EXISTS cfb.order_events (
  id         uuid                   NOT NULL DEFAULT gen_random_uuid(),
  order_id   uuid                   NOT NULL,
  event_type character varying(50)  NOT NULL,
  payload    jsonb                  NOT NULL DEFAULT '{}'::jsonb,
  actor_id   uuid,
  occurred_at timestamptz           NOT NULL DEFAULT now(),
  CONSTRAINT order_events_pkey PRIMARY KEY (id),
  CONSTRAINT order_events_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES cfb.orders(id) ON DELETE CASCADE,
  CONSTRAINT order_events_actor_id_fkey
    FOREIGN KEY (actor_id) REFERENCES cfb.users(id)
);

CREATE INDEX IF NOT EXISTS idx_order_events_order
  ON cfb.order_events USING btree (order_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_order_events_type
  ON cfb.order_events USING btree (event_type);

-- cfb.installments
-- Individual installment records belonging to an order (1–3 per order).
-- installment_number is constrained to 1–3 (product rule).
-- Composite unique on (order_id, installment_number) enforces order indivisibility
-- at the installment level; external_installment_id must also be globally unique.
CREATE TABLE IF NOT EXISTS cfb.installments (
  id                      uuid                     NOT NULL DEFAULT gen_random_uuid(),
  external_installment_id character varying(80)    NOT NULL,
  order_id                uuid                     NOT NULL,
  installment_number      integer                  NOT NULL,
  amount                  numeric(18, 4)           NOT NULL,
  due_date                date                     NOT NULL,
  status                  cfb.installment_status   NOT NULL DEFAULT 'pending'::cfb.installment_status,
  paid_at                 timestamptz,
  paid_amount             numeric(18, 4),
  CONSTRAINT installments_pkey PRIMARY KEY (id),
  CONSTRAINT installments_external_installment_id_key UNIQUE (external_installment_id),
  CONSTRAINT installments_order_id_installment_number_key UNIQUE (order_id, installment_number),
  CONSTRAINT installments_installment_number_check CHECK (((installment_number >= 1) AND (installment_number <= 3))),
  CONSTRAINT installments_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES cfb.orders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_installments_due_status
  ON cfb.installments USING btree (due_date, status);

CREATE INDEX IF NOT EXISTS idx_installments_status
  ON cfb.installments USING btree (status);

-- cfb.installment_events
-- Immutable event log for installments. INSERT-only (enforced by trigger).
CREATE TABLE IF NOT EXISTS cfb.installment_events (
  id              uuid                   NOT NULL DEFAULT gen_random_uuid(),
  installment_id  uuid                   NOT NULL,
  event_type      character varying(50)  NOT NULL,
  payload         jsonb                  NOT NULL DEFAULT '{}'::jsonb,
  actor_id        uuid,
  occurred_at     timestamptz            NOT NULL DEFAULT now(),
  CONSTRAINT installment_events_pkey PRIMARY KEY (id),
  CONSTRAINT installment_events_installment_id_fkey
    FOREIGN KEY (installment_id) REFERENCES cfb.installments(id) ON DELETE CASCADE,
  CONSTRAINT installment_events_actor_id_fkey
    FOREIGN KEY (actor_id) REFERENCES cfb.users(id)
);

CREATE INDEX IF NOT EXISTS idx_installment_events_inst
  ON cfb.installment_events USING btree (installment_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_installment_events_type
  ON cfb.installment_events USING btree (event_type);

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Logs a status_changed event to order_events whenever orders.status changes.
-- Called by trg_orders_status_log (AFTER UPDATE OF status ON cfb.orders).
CREATE OR REPLACE FUNCTION cfb.log_order_status_change()
  RETURNS trigger
  LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        INSERT INTO cfb.order_events (order_id, event_type, payload, actor_id)
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

-- Updates last_seen_at on merchants and end_users when a new order is inserted.
-- Called by trg_orders_touch_seen (AFTER INSERT ON cfb.orders).
CREATE OR REPLACE FUNCTION cfb.touch_merchant_last_seen()
  RETURNS trigger
  LANGUAGE plpgsql
AS $function$
BEGIN
    UPDATE cfb.merchants SET last_seen_at = NOW() WHERE id = NEW.merchant_id;
    UPDATE cfb.end_users SET last_seen_at = NOW() WHERE id = NEW.end_user_id;
    RETURN NEW;
END;
$function$;

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Enforce order_events immutability: block UPDATE and DELETE.
DROP TRIGGER IF EXISTS trg_order_events_immutable ON cfb.order_events;
CREATE TRIGGER trg_order_events_immutable
  BEFORE DELETE OR UPDATE ON cfb.order_events
  FOR EACH ROW EXECUTE FUNCTION cfb.prevent_mutation();

-- Enforce installment_events immutability: block UPDATE and DELETE.
DROP TRIGGER IF EXISTS trg_installment_events_immutable ON cfb.installment_events;
CREATE TRIGGER trg_installment_events_immutable
  BEFORE DELETE OR UPDATE ON cfb.installment_events
  FOR EACH ROW EXECUTE FUNCTION cfb.prevent_mutation();

-- Log order status transitions to the order_events table.
DROP TRIGGER IF EXISTS trg_orders_status_log ON cfb.orders;
CREATE TRIGGER trg_orders_status_log
  AFTER UPDATE OF status ON cfb.orders
  FOR EACH ROW EXECUTE FUNCTION cfb.log_order_status_change();

-- Touch merchant and end_user last_seen_at on every new order.
DROP TRIGGER IF EXISTS trg_orders_touch_seen ON cfb.orders;
CREATE TRIGGER trg_orders_touch_seen
  AFTER INSERT ON cfb.orders
  FOR EACH ROW EXECUTE FUNCTION cfb.touch_merchant_last_seen();

COMMIT;
