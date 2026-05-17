import { z } from 'zod';

export const UserRoleSchema = z.enum(['operator', 'admin', 'auditor']);
export type UserRoleDto = z.infer<typeof UserRoleSchema>;

export const UsersListQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  role: UserRoleSchema.optional(),
  is_active: z
    .union([z.boolean(), z.literal('true'), z.literal('false')])
    .transform((v) => (typeof v === 'boolean' ? v : v === 'true'))
    .optional(),
});
export type UsersListQuery = z.infer<typeof UsersListQuerySchema>;

export const UserUpdateSchema = z
  .object({
    role: UserRoleSchema.optional(),
    is_active: z.boolean().optional(),
  })
  .refine((v) => v.role !== undefined || v.is_active !== undefined, {
    message: 'Debés indicar al menos un cambio.',
  });
export type UserUpdate = z.infer<typeof UserUpdateSchema>;
