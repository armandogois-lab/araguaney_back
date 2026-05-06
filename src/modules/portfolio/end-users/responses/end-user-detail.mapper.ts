import { toEndUserSummary, type EndUserSummaryRow } from './end-user-summary.mapper';

export type EndUserDetailRow = EndUserSummaryRow & {
  ordersTotalAmount: string;
  ordersByStatus: Record<string, number>;
};

export function toEndUserDetail(u: EndUserDetailRow) {
  const summary = toEndUserSummary(u);
  return {
    ...summary,
    orders_summary: {
      total_count: summary.order_count,
      total_amount: u.ordersTotalAmount,
      by_status: {
        available: u.ordersByStatus.available ?? 0,
        assigned: u.ordersByStatus.assigned ?? 0,
        matured: u.ordersByStatus.matured ?? 0,
        defaulted: u.ordersByStatus.defaulted ?? 0,
      },
    },
  };
}
