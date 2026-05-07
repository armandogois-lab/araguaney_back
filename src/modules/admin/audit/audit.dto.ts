import { z } from 'zod';
import { PaginationSchema } from '../../../common/dto/pagination.schema';

const AUDIT_ENTITY_TYPES = [
  'batch',
  'order',
  'installment',
  'certificate',
  'certificate_order',
  'investor',
  'merchant',
  'end_user',
  'user',
  'setting',
  'system',
] as const;

export const AuditListQuerySchema = PaginationSchema.extend({
  entity_type: z.enum(AUDIT_ENTITY_TYPES).optional(),
  entity_id: z.string().min(1).max(50).optional(),
  actor_id: z.string().uuid().optional(),
  action: z.string().min(1).max(50).optional(),
  occurred_at_from: z.coerce.date().optional(),
  occurred_at_to: z.coerce.date().optional(),
}).refine(
  (d) => !d.entity_id || d.entity_type !== undefined,
  { message: 'entity_id requiere entity_type', path: ['entity_id'] },
);

export type AuditListQuery = z.infer<typeof AuditListQuerySchema>;
