import type { Decimal } from '@prisma/client/runtime/library';

export type OrderSummaryRow = {
  id: string;
  external_order_id: string;
  status: string;
  purchase_date: Date;
  max_due_date: Date;
  total_amount: Decimal;
  installments_sum: Decimal;
  num_installments: number;
  imported_at: Date;
  merchant: { id: string; current_name: string; rif: string };
  end_user: {
    id: string;
    external_hash: string;
    national_id: string | null;
    full_name: string | null;
  };
  batches: { id: string; external_code: string };
};

export function toOrderSummary(o: OrderSummaryRow) {
  return {
    id: o.id,
    external_order_id: o.external_order_id,
    status: o.status,
    purchase_date: o.purchase_date.toISOString().slice(0, 10),
    max_due_date: o.max_due_date.toISOString().slice(0, 10),
    total_amount: o.total_amount.toFixed(4),
    installments_sum: o.installments_sum.toFixed(4),
    num_installments: o.num_installments,
    imported_at: o.imported_at.toISOString(),
    merchant: { id: o.merchant.id, current_name: o.merchant.current_name, rif: o.merchant.rif },
    end_user: {
      id: o.end_user.id,
      external_hash: o.end_user.external_hash,
      national_id: o.end_user.national_id,
      full_name: o.end_user.full_name,
    },
    batch: { id: o.batches.id, external_code: o.batches.external_code },
  };
}
