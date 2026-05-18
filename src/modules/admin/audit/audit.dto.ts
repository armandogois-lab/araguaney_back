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
  'role_permission',
  'system',
] as const;

export const AuditListQuerySchema = PaginationSchema.extend({
  entity_type: z.enum(AUDIT_ENTITY_TYPES).optional(),
  entity_id: z.string().min(1).max(50).optional(),
  actor_id: z.string().uuid().optional(),
  action: z.string().min(1).max(50).optional(),
  occurred_at_from: z.coerce.date().optional(),
  // Date-only strings ('YYYY-MM-DD') would coerce to midnight UTC, which
  // would exclude same-day events. We bump to end-of-day so the filter
  // is inclusive of the whole calendar day the user picked.
  occurred_at_to: z
    .union([z.string(), z.date()])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      const isDateOnly = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return undefined;
      if (isDateOnly) {
        // Inclusive end: 23:59:59.999 UTC of that day.
        d.setUTCHours(23, 59, 59, 999);
      }
      return d;
    }),
}).refine((d) => !d.entity_id || d.entity_type !== undefined, {
  message: 'entity_id requiere entity_type',
  path: ['entity_id'],
});

export type AuditListQuery = z.infer<typeof AuditListQuerySchema>;
