import { z } from 'zod';
import { PaginationSchema } from '../../../common/dto/pagination.schema';

export const MerchantsListQuerySchema = PaginationSchema.extend({
  q: z.string().min(1).max(100).optional(),
  sort: z.enum(['name_asc', 'name_desc', 'last_seen_desc']).default('name_asc'),
});

export type MerchantsListQuery = z.infer<typeof MerchantsListQuerySchema>;
