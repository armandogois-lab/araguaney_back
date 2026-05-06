import { createHash } from 'node:crypto';

export type PayloadHashInput = {
  inputs: {
    capital: string;
    rate: string;
    term_days: 14 | 42;
    issue_date: string;
    investor_id: string;
  };
  outputs: {
    price: string;
    nominal_target: string;
    nominal_actual: string;
    investor_paid: string;
    investor_returned: string;
    investor_yield: string;
    shortfall_pct: string;
  };
  order_ids: string[];
};

export function computePayloadHash(p: PayloadHashInput): string {
  const canonical = JSON.stringify({
    inputs: sortKeys(p.inputs),
    outputs: sortKeys(p.outputs),
    order_ids: [...p.order_ids].sort(),
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function sortKeys<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) sorted[k] = obj[k];
  return sorted;
}
