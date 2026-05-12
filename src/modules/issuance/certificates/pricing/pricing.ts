import { Prisma } from '@prisma/client';

const D = Prisma.Decimal;

export type PricingInputs = {
  capital: Prisma.Decimal;
  rate: Prisma.Decimal;
  termDays: 14 | 42;
};

export type Pricing = {
  price: Prisma.Decimal;
  nominalTarget: Prisma.Decimal;
};

export function computePricing(i: PricingInputs): Pricing {
  // Money Market Yield: price = 1 / (1 + rate × days / 360).
  // The "rate" is the simple-interest annualized yield the investor earns on
  // their invested capital (Actual/360). See docs/DECISIONS/2026-05-12-money-market-yield.md.
  const ratio = i.rate.mul(i.termDays).div(360);
  const price = new D(1)
    .div(new D(1).plus(ratio))
    .toDecimalPlaces(6, D.ROUND_HALF_UP);
  const nominalTarget = i.capital.div(price).toDecimalPlaces(4, D.ROUND_HALF_UP);
  return { price, nominalTarget };
}

export type Payouts = {
  investorPaid: Prisma.Decimal;
  investorReturned: Prisma.Decimal;
  investorYield: Prisma.Decimal;
  shortfallPct: Prisma.Decimal;
};

export type PayoutsInputs = {
  capital: Prisma.Decimal;
  price: Prisma.Decimal;
  nominalTarget: Prisma.Decimal;
  nominalActual: Prisma.Decimal;
};

export function computePayouts(opts: PayoutsInputs): Payouts {
  const investorPaid = opts.nominalActual.mul(opts.price).toDecimalPlaces(4, D.ROUND_HALF_UP);
  const investorReturned = opts.capital.minus(investorPaid);
  const investorYield = opts.nominalActual.minus(investorPaid);
  const shortfallPct = opts.nominalTarget.isZero()
    ? new D(0)
    : opts.nominalTarget
        .minus(opts.nominalActual)
        .div(opts.nominalTarget)
        .toDecimalPlaces(6, D.ROUND_HALF_UP);
  return { investorPaid, investorReturned, investorYield, shortfallPct };
}
