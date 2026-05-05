-- 002_ingestion.sql
-- Slice 0 / Foundation — ingestion-domain tables: excel_uploads, batches, import_errors.
-- Idempotent. Apply with: psql -f 002_ingestion.sql or paste into Supabase SQL Editor.
-- Depends on: 001_init.sql (cfb schema, cfb.users, cfb.batch_status enum).

BEGIN;

-- ============================================================
-- INGESTION TABLES
-- Dependency order: excel_uploads → batches → import_errors
-- ============================================================

-- cfb.excel_uploads
-- Raw file metadata for each Excel workbook uploaded by Tesorería.
-- One upload produces exactly one batch (enforced via UNIQUE on batches.excel_upload_id).
CREATE TABLE IF NOT EXISTS cfb.excel_uploads (
  id             uuid                   NOT NULL DEFAULT gen_random_uuid(),
  filename       character varying(255) NOT NULL,
  storage_path   character varying(500) NOT NULL,
  storage_bucket character varying(100) NOT NULL,
  content_hash   character varying(64)  NOT NULL,
  file_size_bytes bigint                NOT NULL,
  mime_type      character varying(100) NOT NULL,
  uploaded_at    timestamptz            NOT NULL DEFAULT now(),
  uploaded_by_id uuid                   NOT NULL,
  CONSTRAINT excel_uploads_pkey PRIMARY KEY (id),
  CONSTRAINT excel_uploads_uploaded_by_id_fkey
    FOREIGN KEY (uploaded_by_id) REFERENCES cfb.users(id)
);

CREATE INDEX IF NOT EXISTS idx_excel_uploads_hash
  ON cfb.excel_uploads USING btree (content_hash);

CREATE INDEX IF NOT EXISTS idx_excel_uploads_uploaded_at
  ON cfb.excel_uploads USING btree (uploaded_at DESC);

CREATE INDEX IF NOT EXISTS idx_excel_uploads_user
  ON cfb.excel_uploads USING btree (uploaded_by_id);

-- cfb.batches
-- Logical batch created from a single excel_upload. Tracks parsing/import lifecycle.
-- One upload → one batch: enforced by UNIQUE (excel_upload_id).
-- external_code is the batch identifier supplied by the source system (also unique).
CREATE TABLE IF NOT EXISTS cfb.batches (
  id                       uuid              NOT NULL DEFAULT gen_random_uuid(),
  external_code            character varying(20) NOT NULL,
  excel_upload_id          uuid              NOT NULL,
  status                   cfb.batch_status  NOT NULL DEFAULT 'uploaded'::cfb.batch_status,
  rows_imported            integer           NOT NULL DEFAULT 0,
  rows_rejected            integer           NOT NULL DEFAULT 0,
  total_orders_amount      numeric(18, 4)    NOT NULL DEFAULT 0,
  total_installments_amount numeric(18, 4)   NOT NULL DEFAULT 0,
  imported_at              timestamptz,
  rejection_reason         text,
  CONSTRAINT batches_pkey PRIMARY KEY (id),
  CONSTRAINT batches_excel_upload_id_key UNIQUE (excel_upload_id),
  CONSTRAINT batches_external_code_key UNIQUE (external_code),
  CONSTRAINT batches_excel_upload_id_fkey
    FOREIGN KEY (excel_upload_id) REFERENCES cfb.excel_uploads(id)
);

CREATE INDEX IF NOT EXISTS idx_batches_imported_at
  ON cfb.batches USING btree (imported_at DESC);

CREATE INDEX IF NOT EXISTS idx_batches_status
  ON cfb.batches USING btree (status);

-- cfb.import_errors
-- Row-level errors encountered during Excel parsing. Immutable log — append only.
-- Cascade-deleted when the parent batch is deleted.
CREATE TABLE IF NOT EXISTS cfb.import_errors (
  id            uuid                   NOT NULL DEFAULT gen_random_uuid(),
  batch_id      uuid                   NOT NULL,
  sheet_name    character varying(100) NOT NULL,
  row_number    integer                NOT NULL,
  field_name    character varying(100),
  error_code    character varying(50)  NOT NULL,
  error_message text                   NOT NULL,
  raw_value     text,
  created_at    timestamptz            NOT NULL DEFAULT now(),
  CONSTRAINT import_errors_pkey PRIMARY KEY (id),
  CONSTRAINT import_errors_batch_id_fkey
    FOREIGN KEY (batch_id) REFERENCES cfb.batches(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_import_errors_batch
  ON cfb.import_errors USING btree (batch_id, sheet_name, row_number);

CREATE INDEX IF NOT EXISTS idx_import_errors_code
  ON cfb.import_errors USING btree (error_code);

COMMIT;
