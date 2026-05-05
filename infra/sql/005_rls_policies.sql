-- 005_rls_policies.sql
-- Slice 0 / Foundation — Row Level Security policies.
-- Idempotent. Apply with: psql -f 005_rls_policies.sql or paste into Supabase SQL Editor.
-- Depends on: 001_init.sql..004_issuance.sql (all 21 tables must exist).

BEGIN;

-- ============================================================
-- ENABLE RLS ON EVERY cfb TABLE
-- ============================================================

ALTER TABLE cfb.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfb.batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfb.certificate_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfb.certificate_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfb.certificate_sequence ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfb.certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfb.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfb.end_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfb.excel_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfb.import_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfb.installment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfb.installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfb.investors ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfb.merchant_name_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfb.merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfb.order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfb.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfb.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfb.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfb.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE cfb.users ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- POLICIES BY TABLE
-- ============================================================

-- cfb.audit_log
DROP POLICY IF EXISTS audit_insert ON cfb.audit_log;
CREATE POLICY audit_insert ON cfb.audit_log
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (cfb.is_authenticated_user());

DROP POLICY IF EXISTS audit_read ON cfb.audit_log;
CREATE POLICY audit_read ON cfb.audit_log
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (cfb.has_permission('audit.read'::character varying));

-- cfb.batches
DROP POLICY IF EXISTS batches_read ON cfb.batches;
CREATE POLICY batches_read ON cfb.batches
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (cfb.has_permission('batch.read'::character varying));

DROP POLICY IF EXISTS batches_update ON cfb.batches;
CREATE POLICY batches_update ON cfb.batches
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (cfb.has_permission('batch.upload'::character varying));

DROP POLICY IF EXISTS batches_write ON cfb.batches;
CREATE POLICY batches_write ON cfb.batches
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (cfb.has_permission('batch.upload'::character varying));

-- cfb.certificate_events
DROP POLICY IF EXISTS cert_events_insert ON cfb.certificate_events;
CREATE POLICY cert_events_insert ON cfb.certificate_events
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (cfb.is_authenticated_user());

DROP POLICY IF EXISTS cert_events_read ON cfb.certificate_events;
CREATE POLICY cert_events_read ON cfb.certificate_events
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (cfb.has_permission('certificate.read'::character varying));

-- cfb.certificate_orders
DROP POLICY IF EXISTS co_insert ON cfb.certificate_orders;
CREATE POLICY co_insert ON cfb.certificate_orders
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((cfb.has_permission('certificate.issue'::character varying) AND (assigned_by_id = cfb.current_user_id())));

DROP POLICY IF EXISTS co_read ON cfb.certificate_orders;
CREATE POLICY co_read ON cfb.certificate_orders
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (cfb.has_permission('certificate.read'::character varying));

DROP POLICY IF EXISTS co_update ON cfb.certificate_orders;
CREATE POLICY co_update ON cfb.certificate_orders
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (cfb.has_permission('certificate.cancel'::character varying));

-- cfb.certificate_sequence
DROP POLICY IF EXISTS cert_seq_admin ON cfb.certificate_sequence;
CREATE POLICY cert_seq_admin ON cfb.certificate_sequence
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (cfb.has_permission('certificate.issue'::character varying));

DROP POLICY IF EXISTS cert_seq_read ON cfb.certificate_sequence;
CREATE POLICY cert_seq_read ON cfb.certificate_sequence
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (cfb.has_permission('certificate.read'::character varying));

-- cfb.certificates
DROP POLICY IF EXISTS certs_cancel ON cfb.certificates;
CREATE POLICY certs_cancel ON cfb.certificates
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (cfb.has_permission('certificate.cancel'::character varying))
  WITH CHECK (cfb.has_permission('certificate.cancel'::character varying));

DROP POLICY IF EXISTS certs_insert ON cfb.certificates;
CREATE POLICY certs_insert ON cfb.certificates
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((cfb.has_permission('certificate.issue'::character varying) AND (issued_by_id = cfb.current_user_id())));

DROP POLICY IF EXISTS certs_read ON cfb.certificates;
CREATE POLICY certs_read ON cfb.certificates
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((cfb.has_permission('certificate.read'::character varying) AND (deleted_at IS NULL)));

DROP POLICY IF EXISTS certs_read_deleted ON cfb.certificates;
CREATE POLICY certs_read_deleted ON cfb.certificates
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (cfb.has_permission('certificate.read_deleted'::character varying));

DROP POLICY IF EXISTS certs_update ON cfb.certificates;
CREATE POLICY certs_update ON cfb.certificates
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (cfb.has_permission('certificate.update'::character varying));

-- cfb.documents
DROP POLICY IF EXISTS documents_insert ON cfb.documents;
CREATE POLICY documents_insert ON cfb.documents
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((cfb.has_permission('document.upload'::character varying) AND (uploaded_by_id = cfb.current_user_id())));

DROP POLICY IF EXISTS documents_read ON cfb.documents;
CREATE POLICY documents_read ON cfb.documents
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (cfb.has_permission('document.read'::character varying));

-- cfb.end_users
DROP POLICY IF EXISTS end_users_read ON cfb.end_users;
CREATE POLICY end_users_read ON cfb.end_users
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (cfb.has_permission('portfolio.read'::character varying));

DROP POLICY IF EXISTS end_users_write ON cfb.end_users;
CREATE POLICY end_users_write ON cfb.end_users
  AS PERMISSIVE FOR ALL TO authenticated
  USING (cfb.has_permission('portfolio.write'::character varying))
  WITH CHECK (cfb.has_permission('portfolio.write'::character varying));

-- cfb.excel_uploads
DROP POLICY IF EXISTS excel_uploads_insert ON cfb.excel_uploads;
CREATE POLICY excel_uploads_insert ON cfb.excel_uploads
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((cfb.has_permission('batch.upload'::character varying) AND (uploaded_by_id = cfb.current_user_id())));

DROP POLICY IF EXISTS excel_uploads_read ON cfb.excel_uploads;
CREATE POLICY excel_uploads_read ON cfb.excel_uploads
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (cfb.has_permission('batch.read'::character varying));

-- cfb.import_errors
DROP POLICY IF EXISTS import_errors_insert ON cfb.import_errors;
CREATE POLICY import_errors_insert ON cfb.import_errors
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (cfb.has_permission('batch.upload'::character varying));

DROP POLICY IF EXISTS import_errors_read ON cfb.import_errors;
CREATE POLICY import_errors_read ON cfb.import_errors
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (cfb.has_permission('batch.read'::character varying));

-- cfb.installment_events
DROP POLICY IF EXISTS installment_events_insert ON cfb.installment_events;
CREATE POLICY installment_events_insert ON cfb.installment_events
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (cfb.is_authenticated_user());

DROP POLICY IF EXISTS installment_events_read ON cfb.installment_events;
CREATE POLICY installment_events_read ON cfb.installment_events
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (cfb.has_permission('portfolio.read'::character varying));

-- cfb.installments
DROP POLICY IF EXISTS installments_read ON cfb.installments;
CREATE POLICY installments_read ON cfb.installments
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (cfb.has_permission('portfolio.read'::character varying));

DROP POLICY IF EXISTS installments_write ON cfb.installments;
CREATE POLICY installments_write ON cfb.installments
  AS PERMISSIVE FOR ALL TO authenticated
  USING (cfb.has_permission('portfolio.write'::character varying))
  WITH CHECK (cfb.has_permission('portfolio.write'::character varying));

-- cfb.investors
DROP POLICY IF EXISTS investors_read ON cfb.investors;
CREATE POLICY investors_read ON cfb.investors
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (cfb.has_permission('investor.read'::character varying));

DROP POLICY IF EXISTS investors_update ON cfb.investors;
CREATE POLICY investors_update ON cfb.investors
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (cfb.has_permission('investor.update'::character varying));

DROP POLICY IF EXISTS investors_write ON cfb.investors;
CREATE POLICY investors_write ON cfb.investors
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (cfb.has_permission('investor.create'::character varying));

-- cfb.merchant_name_history
DROP POLICY IF EXISTS mnh_insert ON cfb.merchant_name_history;
CREATE POLICY mnh_insert ON cfb.merchant_name_history
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (cfb.has_permission('portfolio.write'::character varying));

DROP POLICY IF EXISTS mnh_read ON cfb.merchant_name_history;
CREATE POLICY mnh_read ON cfb.merchant_name_history
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (cfb.has_permission('portfolio.read'::character varying));

DROP POLICY IF EXISTS mnh_update ON cfb.merchant_name_history;
CREATE POLICY mnh_update ON cfb.merchant_name_history
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (cfb.has_permission('portfolio.write'::character varying));

-- cfb.merchants
DROP POLICY IF EXISTS merchants_read ON cfb.merchants;
CREATE POLICY merchants_read ON cfb.merchants
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (cfb.has_permission('portfolio.read'::character varying));

DROP POLICY IF EXISTS merchants_write ON cfb.merchants;
CREATE POLICY merchants_write ON cfb.merchants
  AS PERMISSIVE FOR ALL TO authenticated
  USING (cfb.has_permission('portfolio.write'::character varying))
  WITH CHECK (cfb.has_permission('portfolio.write'::character varying));

-- cfb.order_events
DROP POLICY IF EXISTS order_events_insert ON cfb.order_events;
CREATE POLICY order_events_insert ON cfb.order_events
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (cfb.is_authenticated_user());

DROP POLICY IF EXISTS order_events_read ON cfb.order_events;
CREATE POLICY order_events_read ON cfb.order_events
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (cfb.has_permission('portfolio.read'::character varying));

-- cfb.orders
DROP POLICY IF EXISTS orders_read ON cfb.orders;
CREATE POLICY orders_read ON cfb.orders
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (cfb.has_permission('portfolio.read'::character varying));

DROP POLICY IF EXISTS orders_write ON cfb.orders;
CREATE POLICY orders_write ON cfb.orders
  AS PERMISSIVE FOR ALL TO authenticated
  USING (cfb.has_permission('portfolio.write'::character varying))
  WITH CHECK (cfb.has_permission('portfolio.write'::character varying));

-- cfb.permissions
DROP POLICY IF EXISTS permissions_admin_read ON cfb.permissions;
CREATE POLICY permissions_admin_read ON cfb.permissions
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (cfb.has_permission('permission.manage'::character varying));

DROP POLICY IF EXISTS permissions_admin_write ON cfb.permissions;
CREATE POLICY permissions_admin_write ON cfb.permissions
  AS PERMISSIVE FOR ALL TO authenticated
  USING (cfb.has_permission('permission.manage'::character varying))
  WITH CHECK (cfb.has_permission('permission.manage'::character varying));

-- cfb.role_permissions
DROP POLICY IF EXISTS role_permissions_admin_read ON cfb.role_permissions;
CREATE POLICY role_permissions_admin_read ON cfb.role_permissions
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (cfb.has_permission('permission.manage'::character varying));

DROP POLICY IF EXISTS role_permissions_admin_write ON cfb.role_permissions;
CREATE POLICY role_permissions_admin_write ON cfb.role_permissions
  AS PERMISSIVE FOR ALL TO authenticated
  USING (cfb.has_permission('permission.manage'::character varying))
  WITH CHECK (cfb.has_permission('permission.manage'::character varying));

-- cfb.settings
DROP POLICY IF EXISTS settings_read ON cfb.settings;
CREATE POLICY settings_read ON cfb.settings
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (cfb.is_authenticated_user());

DROP POLICY IF EXISTS settings_write ON cfb.settings;
CREATE POLICY settings_write ON cfb.settings
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (cfb.has_permission('settings.manage'::character varying))
  WITH CHECK (cfb.has_permission('settings.manage'::character varying));

-- cfb.users
DROP POLICY IF EXISTS users_admin_all ON cfb.users;
CREATE POLICY users_admin_all ON cfb.users
  AS PERMISSIVE FOR ALL TO authenticated
  USING (cfb.has_permission('user.manage'::character varying))
  WITH CHECK (cfb.has_permission('user.manage'::character varying));

DROP POLICY IF EXISTS users_read ON cfb.users;
CREATE POLICY users_read ON cfb.users
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (cfb.is_authenticated_user());

DROP POLICY IF EXISTS users_self_update ON cfb.users;
CREATE POLICY users_self_update ON cfb.users
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((auth_user_id = auth.uid()))
  WITH CHECK ((auth_user_id = auth.uid()));

COMMIT;
