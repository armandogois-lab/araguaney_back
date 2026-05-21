import { z } from 'zod';

function startOfTodayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

const SweepBase = z.object({
  term_days: z.union([z.literal(14), z.literal(42)]),
  issue_date: z.coerce.date(),
  rate: z.coerce.number().min(0).max(0.999999).optional(),
});

export const SweepSimulateSchema = SweepBase.refine(
  (d) => d.issue_date.getTime() >= startOfTodayUTC().getTime(),
  { message: 'La fecha de emisión no puede ser anterior a hoy' },
);

export const SweepIssueSchema = SweepBase.extend({
  // Cap matches CertificateIssueSchema (raised from 2000 to 50000 after a
  // real sweep tried to barrer ~14k available orders and got a generic
  // "Datos de entrada inválidos" 400 from the Zod pipe before the sweep
  // service ran.
  order_ids: z.array(z.string().uuid()).min(1).max(50000),
  expected_payload_hash: z.string().regex(/^[a-f0-9]{64}$/),
}).refine((d) => d.issue_date.getTime() >= startOfTodayUTC().getTime(), {
  message: 'La fecha de emisión no puede ser anterior a hoy',
});

export type SweepSimulate = z.infer<typeof SweepSimulateSchema>;
export type SweepIssue = z.infer<typeof SweepIssueSchema>;
