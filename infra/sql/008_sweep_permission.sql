-- 008_sweep_permission.sql
-- Adds the certificate.sweep permission and grants it to operator + admin.
-- Idempotent — safe to re-run.
-- Depends on: 001_init.sql (cfb.user_role enum) and 005_rls_policies.sql (cfb.permissions, cfb.role_permissions tables).

BEGIN;

INSERT INTO cfb.permissions (key, description) VALUES
  ('certificate.sweep', 'Emitir certificado sweep semanal (barrido del remanente)')
ON CONFLICT (key) DO NOTHING;

INSERT INTO cfb.role_permissions (role, permission_id)
SELECT v.role::cfb.user_role, p.id
FROM (VALUES
  ('operator', 'certificate.sweep'),
  ('admin',    'certificate.sweep')
) AS v(role, key)
JOIN cfb.permissions p ON p.key = v.key
ON CONFLICT (role, permission_id) DO NOTHING;

COMMIT;
