import { Prisma } from '@prisma/client';

export type EligibleOrder = {
  id: string;
  external_order_id: string;
  installments_sum: Prisma.Decimal;
  merchant_id: string;
  num_installments: number;
  max_due_date: Date;
};

export type FillResult = {
  selected: EligibleOrder[];
  nominalActual: Prisma.Decimal;
};

export function fillPool(eligible: EligibleOrder[], target: Prisma.Decimal): FillResult {
  const sorted = [...eligible].sort((a, b) => {
    const cmp = b.installments_sum.comparedTo(a.installments_sum);
    if (cmp !== 0) return cmp;
    return a.external_order_id.localeCompare(b.external_order_id);
  });
  const selected: EligibleOrder[] = [];
  let nominalActual = new Prisma.Decimal(0);
  for (const o of sorted) {
    const tentative = nominalActual.plus(o.installments_sum);
    if (tentative.lessThanOrEqualTo(target)) {
      selected.push(o);
      nominalActual = tentative;
    }
  }
  return { selected, nominalActual };
}
