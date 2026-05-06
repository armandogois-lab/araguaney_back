import { z } from 'zod';

export const BatchErrorsQuerySchema = z.object({
  error_code: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export type BatchErrorsQuery = z.infer<typeof BatchErrorsQuerySchema>;
