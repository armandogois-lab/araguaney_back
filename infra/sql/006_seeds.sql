-- 006_seeds.sql
-- Slice 0 / Foundation — initial seeds.
-- Idempotent via ON CONFLICT DO NOTHING.
-- Apply with: psql -f 006_seeds.sql or paste into Supabase SQL Editor.
-- Depends on: 001_init.sql..005_rls_policies.sql (all reference target tables).

BEGIN;

-- ============================================================
-- PERMISSIONS (20 rows)
-- ============================================================
INSERT INTO cfb.permissions (key, description) VALUES
  ('audit.read',             'Ver el audit_log completo'),
  ('batch.read',             'Ver lotes y su contenido (incluye errores de import)'),
  ('batch.upload',           'Subir y procesar archivos Excel para crear nuevos lotes'),
  ('certificate.cancel',     'Cancelar / soft-delete un certificado emitido'),
  ('certificate.issue',      'Emitir nuevos certificados (asigna órdenes)'),
  ('certificate.read',       'Ver certificados emitidos y su detalle (excluye eliminados)'),
  ('certificate.read_deleted','Ver certificados eliminados/cancelados'),
  ('certificate.simulate',   'Correr simulaciones del pool sin emitir'),
  ('certificate.update',     'Modificar campos no-financieros de un certificado'),
  ('document.delete',        'Borrar documentos del storage (caso excepcional)'),
  ('document.read',          'Ver y descargar documentos asociados'),
  ('document.upload',        'Subir documentos asociados a una entidad'),
  ('investor.create',        'Registrar un nuevo inversor'),
  ('investor.read',          'Ver el listado y detalle de inversores'),
  ('investor.update',        'Modificar datos de un inversor existente'),
  ('permission.manage',      'Modificar el catálogo de permisos y la matriz role→permission'),
  ('portfolio.read',         'Ver órdenes, cuotas, comercios y clientes finales'),
  ('portfolio.write',        'Crear/modificar registros de cartera (típicamente vía import)'),
  ('settings.manage',        'Modificar la configuración global (umbrales, defaults)'),
  ('user.manage',            'Crear/modificar/desactivar usuarios del sistema')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- ROLE-PERMISSION MATRIX (40 rows)
-- Look up permission_id by key for portability across DB instances.
-- operator: 13 rows | admin: 20 rows | auditor: 7 rows
-- ============================================================
INSERT INTO cfb.role_permissions (role, permission_id)
SELECT v.role::cfb.user_role, p.id
FROM (VALUES
  -- operator (13)
  ('operator', 'audit.read'),
  ('operator', 'batch.read'),
  ('operator', 'batch.upload'),
  ('operator', 'certificate.issue'),
  ('operator', 'certificate.read'),
  ('operator', 'certificate.simulate'),
  ('operator', 'document.read'),
  ('operator', 'document.upload'),
  ('operator', 'investor.create'),
  ('operator', 'investor.read'),
  ('operator', 'investor.update'),
  ('operator', 'portfolio.read'),
  ('operator', 'portfolio.write'),
  -- admin (20)
  ('admin',    'audit.read'),
  ('admin',    'batch.read'),
  ('admin',    'batch.upload'),
  ('admin',    'certificate.cancel'),
  ('admin',    'certificate.issue'),
  ('admin',    'certificate.read'),
  ('admin',    'certificate.read_deleted'),
  ('admin',    'certificate.simulate'),
  ('admin',    'certificate.update'),
  ('admin',    'document.delete'),
  ('admin',    'document.read'),
  ('admin',    'document.upload'),
  ('admin',    'investor.create'),
  ('admin',    'investor.read'),
  ('admin',    'investor.update'),
  ('admin',    'permission.manage'),
  ('admin',    'portfolio.read'),
  ('admin',    'portfolio.write'),
  ('admin',    'settings.manage'),
  ('admin',    'user.manage'),
  -- auditor (7)
  ('auditor',  'audit.read'),
  ('auditor',  'batch.read'),
  ('auditor',  'certificate.read'),
  ('auditor',  'certificate.read_deleted'),
  ('auditor',  'document.read'),
  ('auditor',  'investor.read'),
  ('auditor',  'portfolio.read')
) AS v(role, key)
JOIN cfb.permissions p ON p.key = v.key
ON CONFLICT (role, permission_id) DO NOTHING;

-- ============================================================
-- INTERNAL INVESTOR — Cashea sweep buyer (1 row)
-- UUID kept verbatim for byte-equivalence with live Supabase row.
-- Partial unique index uq_investors_one_internal protects duplicates.
-- email and phone are NULL in the live row.
-- ============================================================
INSERT INTO cfb.investors (id, legal_name, rif, kind, status, email, phone, notes)
VALUES (
  '9278c875-991c-4472-b2c4-6fd70c512719',
  'Grupo Cashea Ve C.A.',
  'J-50154179-5',
  'internal',
  'active',
  NULL,
  NULL,
  'Inversor interno usado por el certificado de barrido semanal.'
)
ON CONFLICT (rif) DO NOTHING;

-- ============================================================
-- CERTIFICATE SEQUENCE SINGLETON (1 row)
-- current_number = 4571 means next code issued will be C4572A.
-- ============================================================
INSERT INTO cfb.certificate_sequence (id, current_number, current_letter)
VALUES (1, 4571, 'A')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- SETTINGS SINGLETON (1 row)
-- shortfall_warning_threshold    = 0.5%
-- concentration_warning_threshold = 15%
-- default_sweep_rate             = 8%
-- ============================================================
INSERT INTO cfb.settings (id, shortfall_warning_threshold, concentration_warning_threshold, default_sweep_rate)
VALUES (1, 0.005000, 0.150000, 0.080000)
ON CONFLICT (id) DO NOTHING;

COMMIT;
