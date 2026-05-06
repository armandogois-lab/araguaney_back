import { z } from 'zod';
import { PaginationSchema } from '../../../common/dto/pagination.schema';

export const EndUsersListQuerySchema = PaginationSchema.extend({
  q: z.string().min(1).max(100).optional(),
  has_national_id: z.coerce.boolean().optional(),
  sort: z.enum(['last_seen_desc', 'first_seen_desc', 'external_hash_asc']).default('last_seen_desc'),
});

export const EndUserUpdateSchema = z
  .object({
    full_name: z.string().min(1).max(255).nullable().optional(),
    national_id: z.string().min(1).max(255).nullable().optional(),
    email: z.string().email().max(255).nullable().optional(),
    phone: z.string().min(1).max(255).nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Al menos un campo debe ser provisto' });

export type EndUsersListQuery = z.infer<typeof EndUsersListQuerySchema>;
export type EndUserUpdate = z.infer<typeof EndUserUpdateSchema>;
