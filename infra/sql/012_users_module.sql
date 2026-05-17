-- 012_users_module.sql
-- Slice 11: /users management module
-- Adds user.read / user.update permissions, grants them to admin, and opens RLS
-- on cfb.users for admins (without breaking the existing self-read for /me).
--
-- Context: 005_rls_policies.sql already has:
--   users_admin_all  → FOR ALL USING has_permission('user.manage')  (keeps working)
--   users_read       → FOR SELECT USING is_authenticated_user()     (self-read /me)
--   users_self_update → FOR UPDATE USING auth_user_id = auth.uid()  (self-update)
--
-- This migration adds two granular permissions so Tesorería admins can list
-- and patch other users without the broad 'user.manage' permission.
--
-- Idempotent: ON CONFLICT DO NOTHING throughout.
-- Depends on: 001_init.sql, 005_rls_policies.sql, 006_seeds.sql.

BEGIN;

-- 1. Permission catalog
INSERT INTO cfb.permissions (key, description) VALUES
  ('user.read',   'Listar usuarios del sistema'),
  ('user.update', 'Modificar rol o is_active de otros usuarios')
ON CONFLICT (key) DO NOTHING;

-- 2. Default role grants: only admin
INSERT INTO cfb.role_permissions (role, permission_id, granted_by_id)
SELECT 'admin'::cfb.user_role, p.id, NULL
FROM cfb.permissions p
WHERE p.key IN ('user.read', 'user.update')
ON CONFLICT DO NOTHING;

-- 3. RLS policies on cfb.users
--    Replace the coarse users_read (all authenticated) with a policy that
--    allows either self-read OR having user.read permission.
--    The users_admin_all and users_self_update policies from 005 are preserved.
DROP POLICY IF EXISTS users_select ON cfb.users;
CREATE POLICY users_select ON cfb.users
  FOR SELECT
  USING (
    auth_user_id = auth.uid()
    OR cfb.has_permission('user.read')
  );

DROP POLICY IF EXISTS users_update ON cfb.users;
CREATE POLICY users_update ON cfb.users
  FOR UPDATE
  USING (
    cfb.has_permission('user.update')
    AND auth_user_id <> auth.uid()
  )
  WITH CHECK (
    cfb.has_permission('user.update')
    AND auth_user_id <> auth.uid()
  );

COMMIT;
