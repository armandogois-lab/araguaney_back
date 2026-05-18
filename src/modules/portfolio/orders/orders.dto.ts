import { z } from 'zod';
import { PaginationSchema } from '../../../common/dto/pagination.schema';

export const OrderStatusEnum = z.enum([
  'available',
  'reserved',
  'assigned',
  'matured',
  'defaulted',
]);

const OrdersFiltersBase = z.object({
  status: OrderStatusEnum.optional(),
  merchant_id: z.string().uuid().optional(),
  end_user_id: z.string().uuid().optional(),
  batch_id: z.string().uuid().optional(),
  purchase_date_from: z.coerce.date().optional(),
  purchase_date_to: z.coerce.date().optional(),
  max_due_date_lte: z.coerce.date().optional(),
});

export const OrdersListQuerySchema = PaginationSchema.extend({
  ...OrdersFiltersBase.shape,
  q: z.string().min(1).max(100).optional(),
  sort: z
    .enum(['purchase_date_desc', 'purchase_date_asc', 'max_due_date_asc', 'max_due_date_desc'])
    .default('purchase_date_desc'),
});

export const OrdersStatsQuerySchema = OrdersFiltersBase;

export type OrdersListQuery = z.infer<typeof OrdersListQuerySchema>;
export type OrdersStatsQuery = z.infer<typeof OrdersStatsQuerySchema>;
