export type PermissionRow = {
  id: string;
  key: string;
  description: string;
};

export type RolePermissionRow = {
  role: string;
  permission: { key: string };
};

export function toRolePermissionsMatrix(opts: {
  permissions: PermissionRow[];
  rolePermissions: RolePermissionRow[];
}) {
  const matrix: Record<string, string[]> = {
    operator: [],
    admin: [],
    auditor: [],
  };
  for (const rp of opts.rolePermissions) {
    const bucket = matrix[rp.role];
    if (bucket) bucket.push(rp.permission.key);
  }
  return {
    permissions: opts.permissions.map((p) => ({
      key: p.key,
      description: p.description,
    })),
    roles: ['operator', 'admin', 'auditor'] as const,
    matrix,
  };
}
