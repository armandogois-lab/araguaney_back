import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';

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

export type BuildHashPayloadInput = {
  capital: Prisma.Decimal;
  rate: Prisma.Decimal;
  termDays: 14 | 42;
  issueDate: Date;
  investorId: string;
  price: Prisma.Decimal;
  nominalTarget: Prisma.Decimal;
  nominalActual: Prisma.Decimal;
  payouts: {
    investorPaid: Prisma.Decimal;
    investorReturned: Prisma.Decimal;
    investorYield: Prisma.Decimal;
    shortfallPct: Prisma.Decimal;
  };
  selectedOrderIds: string[];
};

export function buildHashPayload(opts: BuildHashPayloadInput): PayloadHashInput {
  return {
    inputs: {
      capital: opts.capital.toFixed(4),
      rate: opts.rate.toFixed(6),
      term_days: opts.termDays,
      issue_date: opts.issueDate.toISOString().slice(0, 10),
      investor_id: opts.investorId,
    },
    outputs: {
      price: opts.price.toFixed(6),
      nominal_target: opts.nominalTarget.toFixed(4),
      nominal_actual: opts.nominalActual.toFixed(4),
      investor_paid: opts.payouts.investorPaid.toFixed(4),
      investor_returned: opts.payouts.investorReturned.toFixed(4),
      investor_yield: opts.payouts.investorYield.toFixed(4),
      shortfall_pct: opts.payouts.shortfallPct.toFixed(6),
    },
    order_ids: opts.selectedOrderIds,
  };
}
