import type { Decimal } from '@prisma/client/runtime/library';
import { toOrderSummary, type OrderSummaryRow } from './order-summary.mapper';

export type OrderDetailRow = OrderSummaryRow & {
  installments: Array<{
    id: string;
    external_installment_id: string;
    installment_number: number;
    amount: Decimal;
    due_date: Date;
    status: string;
    paid_amount: Decimal | null;
  }>;
  order_events: Array<{
    id: string;
    event_type: string;
    occurred_at: Date;
    payload: unknown;
    actor_id: string | null;
  }>;
};

export function toOrderDetail(o: OrderDetailRow) {
  return {
    ...toOrderSummary(o),
    installments: o.installments.map((i) => ({
      id: i.id,
      external_installment_id: i.external_installment_id,
      installment_number: i.installment_number,
      amount: i.amount.toFixed(4),
      due_date: i.due_date.toISOString().slice(0, 10),
      status: i.status,
      paid_amount: i.paid_amount?.toFixed(4) ?? null,
    })),
    events: o.order_events.map((e) => ({
      id: e.id,
      event_type: e.event_type,
      occurred_at: e.occurred_at.toISOString(),
      payload: e.payload,
      actor_id: e.actor_id,
    })),
  };
}
