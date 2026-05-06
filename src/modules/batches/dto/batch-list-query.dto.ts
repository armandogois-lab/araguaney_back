import { z } from 'zod';

export const BatchListQuerySchema = z.object({
  status: z.enum(['uploaded', 'parsing', 'imported', 'rejected', 'archived']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  uploaded_by_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type BatchListQuery = z.infer<typeof BatchListQuerySchema>;
