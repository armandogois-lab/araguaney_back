import { z } from 'zod';
import { PaginationSchema } from '../../../common/dto/pagination.schema';

export const InstallmentsListQuerySchema = PaginationSchema.extend({
  status: z.enum(['pending', 'due', 'paid', 'overdue']).optional(),
  order_id: z.string().uuid().optional(),
  due_date_from: z.coerce.date().optional(),
  due_date_to: z.coerce.date().optional(),
  sort: z.enum(['due_date_asc', 'due_date_desc', 'amount_desc']).default('due_date_asc'),
});

export type InstallmentsListQuery = z.infer<typeof InstallmentsListQuerySchema>;
