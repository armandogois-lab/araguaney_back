import type { Decimal } from '@prisma/client/runtime/library';

export type MerchantSummaryRow = {
  id: string;
  rif: string;
  current_name: string;
  first_seen_at: Date;
  last_seen_at: Date;
  _count: { orders: number };
  ordersAggregateAmount: Decimal | null;
};

export function toMerchantSummary(m: MerchantSummaryRow) {
  return {
    id: m.id,
    rif: m.rif,
    current_name: m.current_name,
    first_seen_at: m.first_seen_at.toISOString(),
    last_seen_at: m.last_seen_at.toISOString(),
    order_count: m._count.orders,
    total_orders_amount: (m.ordersAggregateAmount ?? toDecimalZero()).toFixed(4),
  };
}

function toDecimalZero(): { toFixed: (n: number) => string } {
  return { toFixed: () => '0.0000' };
}
