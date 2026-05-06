import type { Decimal } from '@prisma/client/runtime/library';
import { toCertificateSummary, type CertificateSummaryRow } from './certificate-summary.mapper';

export type CertificateDetailRow = CertificateSummaryRow & {
  investor_returned: Decimal;
  payload_hash: string;
  certificate_orders: Array<{
    order: {
      id: string;
      external_order_id: string;
      merchant: { id: string; current_name: string; rif: string };
      purchase_date: Date;
      max_due_date: Date;
      installments: Array<{
        installment_number: number;
        amount: Decimal;
        due_date: Date;
        status: string;
      }>;
    };
    installments_sum_snapshot: Decimal;
    assigned_at: Date;
  }>;
  certificate_events: Array<{
    id: string;
    event_type: string;
    occurred_at: Date;
    payload: unknown;
    actor_id: string | null;
  }>;
};

export function toCertificateDetail(c: CertificateDetailRow) {
  return {
    ...toCertificateSummary(c),
    investor_returned: c.investor_returned.toFixed(4),
    payload_hash: c.payload_hash,
    orders: c.certificate_orders.map((co) => ({
      id: co.order.id,
      external_order_id: co.order.external_order_id,
      merchant: {
        id: co.order.merchant.id,
        current_name: co.order.merchant.current_name,
        rif: co.order.merchant.rif,
      },
      purchase_date: co.order.purchase_date.toISOString().slice(0, 10),
      max_due_date: co.order.max_due_date.toISOString().slice(0, 10),
      installments_sum_snapshot: co.installments_sum_snapshot.toFixed(4),
      assigned_at: co.assigned_at.toISOString(),
      installments: co.order.installments.map((i) => ({
        installment_number: i.installment_number,
        amount: i.amount.toFixed(4),
        due_date: i.due_date.toISOString().slice(0, 10),
        status: i.status,
      })),
    })),
    events: c.certificate_events.map((e) => ({
      id: e.id,
      event_type: e.event_type,
      occurred_at: e.occurred_at.toISOString(),
      payload: e.payload,
      actor_id: e.actor_id,
    })),
  };
}
