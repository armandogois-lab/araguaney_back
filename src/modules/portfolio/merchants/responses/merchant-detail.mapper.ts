import { toMerchantSummary, type MerchantSummaryRow } from './merchant-summary.mapper';

export type MerchantDetailRow = MerchantSummaryRow & {
  merchant_name_history: Array<{ id: string; name: string; effective_from: Date; effective_to: Date | null }>;
  ordersByStatus: Record<string, number>;
};

export function toMerchantDetail(m: MerchantDetailRow) {
  const summary = toMerchantSummary(m);
  return {
    ...summary,
    name_history: m.merchant_name_history
      .slice()
      .sort((a, b) => b.effective_from.getTime() - a.effective_from.getTime())
      .map((h) => ({
        id: h.id,
        name: h.name,
        effective_from: h.effective_from.toISOString().slice(0, 10),
        effective_to: h.effective_to?.toISOString().slice(0, 10) ?? null,
      })),
    orders_summary: {
      total_count: summary.order_count,
      total_amount: summary.total_orders_amount,
      by_status: {
        available: m.ordersByStatus.available ?? 0,
        assigned: m.ordersByStatus.assigned ?? 0,
        matured: m.ordersByStatus.matured ?? 0,
        defaulted: m.ordersByStatus.defaulted ?? 0,
      },
    },
  };
}
