import { z } from 'zod';
import { PaginationSchema } from '../../../common/dto/pagination.schema';

function startOfTodayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

const SimulateBase = z.object({
  investor_id: z.string().uuid(),
  capital: z.coerce.number().positive(),
  rate: z.coerce.number().min(0).max(0.999999),
  term_days: z.union([z.literal(14), z.literal(42)]),
  issue_date: z.coerce.date(),
});

export const CertificateSimulateSchema = SimulateBase.refine(
  (d) => d.issue_date.getTime() >= startOfTodayUTC().getTime(),
  { message: 'La fecha de emisión no puede ser anterior a hoy' },
);

export const CertificateIssueSchema = SimulateBase.extend({
  order_ids: z.array(z.string().uuid()).min(1).max(2000),
  expected_payload_hash: z.string().regex(/^[a-f0-9]{64}$/),
}).refine((d) => d.issue_date.getTime() >= startOfTodayUTC().getTime(), {
  message: 'La fecha de emisión no puede ser anterior a hoy',
});

export const CertificatesListQuerySchema = PaginationSchema.extend({
  status: z.enum(['draft', 'issued', 'matured', 'cancelled']).optional(),
  certificate_type: z.enum(['standard', 'sweep']).optional(),
  investor_id: z.string().uuid().optional(),
  issue_date_from: z.coerce.date().optional(),
  issue_date_to: z.coerce.date().optional(),
  q: z.string().min(1).max(100).optional(),
  sort: z.enum(['issue_date_desc', 'issue_date_asc', 'code_asc']).default('issue_date_desc'),
  include_deleted: z.coerce.boolean().optional().default(false),
});

export const CertificateCancelSchema = z.object({
  reason: z.string().min(5).max(1000),
});

export type CertificateSimulate = z.infer<typeof CertificateSimulateSchema>;
export type CertificateIssue = z.infer<typeof CertificateIssueSchema>;
export type CertificatesListQuery = z.infer<typeof CertificatesListQuerySchema>;
export type CertificateCancel = z.infer<typeof CertificateCancelSchema>;
