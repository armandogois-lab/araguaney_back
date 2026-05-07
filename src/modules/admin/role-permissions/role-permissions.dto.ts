import { z } from 'zod';

export const RoleParamSchema = z.enum(['operator', 'admin', 'auditor']);
export const PermissionKeyParamSchema = z
  .string()
  .min(3)
  .max(50)
  .regex(/^[a-z_]+\.[a-z_]+$/);

export type RoleParam = z.infer<typeof RoleParamSchema>;
export type PermissionKeyParam = z.infer<typeof PermissionKeyParamSchema>;
