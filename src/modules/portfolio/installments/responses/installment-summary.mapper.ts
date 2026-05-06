import type { Decimal } from '@prisma/client/runtime/library';

export type InstallmentSummaryRow = {
  id: string;
  external_installment_id: string;
  order_id: string;
  installment_number: number;
  amount: Decimal;
  due_date: Date;
  status: string;
  paid_amount: Decimal | null;
  order: {
    external_order_id: string;
    merchant: { current_name: string; rif: string };
  };
};

export function toInstallmentSummary(i: InstallmentSummaryRow) {
  return {
    id: i.id,
    external_installment_id: i.external_installment_id,
    order_id: i.order_id,
    installment_number: i.installment_number,
    amount: i.amount.toFixed(4),
    due_date: i.due_date.toISOString().slice(0, 10),
    status: i.status,
    paid_amount: i.paid_amount?.toFixed(4) ?? null,
    order: {
      external_order_id: i.order.external_order_id,
      merchant: { current_name: i.order.merchant.current_name, rif: i.order.merchant.rif },
    },
  };
}
