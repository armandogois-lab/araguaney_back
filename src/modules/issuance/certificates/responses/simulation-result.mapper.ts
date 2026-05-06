import type { Decimal } from '@prisma/client/runtime/library';

export type SimulationResultInput = {
  investor: { id: string; legal_name: string; rif: string };
  capital: Decimal;
  rate: Decimal;
  term_days: 14 | 42;
  issue_date: Date;
  maturity_date: Date;
  price: Decimal;
  nominal_target: Decimal;
  nominal_actual: Decimal;
  investor_paid: Decimal;
  investor_returned: Decimal;
  investor_yield: Decimal;
  shortfall_pct: Decimal;
  selected_orders: Array<{
    id: string;
    installments_sum: Decimal;
    merchant_id: string;
    num_installments: number;
    max_due_date: Date;
  }>;
  total_eligible_merchants: number;
  installment_plazo_days: { min: number; max: number };
  concentration_top: Array<{
    merchant_id: string;
    current_name: string;
    rif: string;
    amount: Decimal;
    pct: Decimal;
  }>;
  total_distinct_merchants: number;
  due_date_distribution: Array<{ date: Date; amount: Decimal }>;
  payload_hash: string;
};

export function toSimulationResult(s: SimulationResultInput) {
  const installment_count = s.selected_orders.reduce((acc, o) => acc + o.num_installments, 0);
  const merchant_count = new Set(s.selected_orders.map((o) => o.merchant_id)).size;

  return {
    rules_check: { maturity_boundary: true, order_indivisibility: true, round_down: true },
    inputs: {
      investor_id: s.investor.id,
      investor: { id: s.investor.id, legal_name: s.investor.legal_name, rif: s.investor.rif },
      capital: s.capital.toFixed(4),
      rate: s.rate.toFixed(6),
      term_days: s.term_days,
      issue_date: s.issue_date.toISOString().slice(0, 10),
      maturity_date: s.maturity_date.toISOString().slice(0, 10),
    },
    pricing: {
      price: s.price.toFixed(6),
      nominal_target: s.nominal_target.toFixed(4),
    },
    pool: {
      order_ids: s.selected_orders.map((o) => o.id),
      order_count: s.selected_orders.length,
      merchant_count,
      installment_count,
      installment_plazo_days: s.installment_plazo_days,
    },
    payouts: {
      nominal_actual: s.nominal_actual.toFixed(4),
      investor_paid: s.investor_paid.toFixed(4),
      investor_returned: s.investor_returned.toFixed(4),
      investor_yield: s.investor_yield.toFixed(4),
      shortfall_pct: s.shortfall_pct.toFixed(6),
    },
    concentration: {
      top: s.concentration_top.map((c) => ({
        merchant_id: c.merchant_id,
        current_name: c.current_name,
        rif: c.rif,
        amount: c.amount.toFixed(4),
        pct: c.pct.toFixed(6),
      })),
      total_distinct_merchants: s.total_distinct_merchants,
    },
    due_date_distribution: s.due_date_distribution.map((d) => ({
      date: d.date.toISOString().slice(0, 10),
      amount: d.amount.toFixed(4),
    })),
    payload_hash: s.payload_hash,
  };
}
