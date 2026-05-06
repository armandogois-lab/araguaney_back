import { z } from 'zod';
import { PaginationSchema } from '../../../common/dto/pagination.schema';

export const InvestorsListQuerySchema = PaginationSchema.extend({
  q: z.string().min(1).max(100).optional(),
  kind: z.enum(['juridica', 'natural', 'internal']).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  sort: z.enum(['name_asc', 'name_desc', 'created_desc']).default('name_asc'),
});

export const InvestorCreateSchema = z.object({
  legal_name: z.string().min(1).max(255),
  rif: z.string().min(1).max(50),
  kind: z.enum(['juridica', 'natural']),
  email: z.string().email().max(255).nullable().optional(),
  phone: z.string().min(1).max(50).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

export type InvestorsListQuery = z.infer<typeof InvestorsListQuerySchema>;
export type InvestorCreate = z.infer<typeof InvestorCreateSchema>;
