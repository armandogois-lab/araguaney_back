import type { Decimal } from '@prisma/client/runtime/library';

export type StatsGroupRow = {
  status: string;
  _count: { _all: number };
  _sum: { total_amount: Decimal | null; installments_sum: Decimal | null };
};

const STATUSES = ['available', 'assigned', 'matured', 'defaulted'] as const;

export function toOrderStats(rows: StatsGroupRow[]) {
  const by_status: Record<
    string,
    { count: number; total_amount: string; total_installments_amount: string }
  > = {};
  for (const s of STATUSES) {
    by_status[s] = { count: 0, total_amount: '0.0000', total_installments_amount: '0.0000' };
  }
  let total_orders = 0;
  for (const row of rows) {
    by_status[row.status] = {
      count: row._count._all,
      total_amount: (row._sum.total_amount ?? toDecimalZero()).toFixed(4),
      total_installments_amount: (row._sum.installments_sum ?? toDecimalZero()).toFixed(4),
    };
    total_orders += row._count._all;
  }
  return {
    by_status,
    total_orders,
    available_capital: by_status.available!.total_installments_amount,
  };
}

function toDecimalZero(): { toFixed: (n: number) => string } {
  return { toFixed: () => '0.0000' };
}
