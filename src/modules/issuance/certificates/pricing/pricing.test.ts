import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { computePricing, computePayouts } from './pricing';

const D = (s: string) => new Prisma.Decimal(s);

describe('computePricing', () => {
  it('computes price for 13% × 42d as 0.984833', () => {
    const r = computePricing({ capital: D('100000'), rate: D('0.13'), termDays: 42 });
    expect(r.price.toFixed(6)).toBe('0.984833');
  });

  it('computes price for 8% × 14d as 0.996889', () => {
    const r = computePricing({ capital: D('100000'), rate: D('0.08'), termDays: 14 });
    expect(r.price.toFixed(6)).toBe('0.996889');
  });

  it('computes nominal_target = capital / price (HALF_UP to 4 decimals)', () => {
    const r = computePricing({ capital: D('100000'), rate: D('0.13'), termDays: 42 });
    expect(r.nominalTarget.toFixed(4)).toBe('101540.0581');
  });

  it('handles zero rate → price = 1, target = capital', () => {
    const r = computePricing({ capital: D('1000'), rate: D('0'), termDays: 14 });
    expect(r.price.toFixed(6)).toBe('1.000000');
    expect(r.nominalTarget.toFixed(4)).toBe('1000.0000');
  });
});

describe('computePayouts', () => {
  it('investor_paid = nominal_actual × price (HALF_UP to 4 decimals)', () => {
    const r = computePayouts({
      capital: D('100000'),
      price: D('0.984833'),
      nominalTarget: D('101540.0581'),
      nominalActual: D('101540.0034'),
    });
    expect(r.investorPaid.toFixed(4)).toBe('99999.9462');
  });

  it('investor_returned = capital − investor_paid', () => {
    const r = computePayouts({
      capital: D('100000'),
      price: D('0.984833'),
      nominalTarget: D('101540.0581'),
      nominalActual: D('101540.0034'),
    });
    // investor_paid = 99999.9462, returned = 100000 - 99999.9462 = 0.0538
    expect(r.investorReturned.toFixed(4)).toBe('0.0538');
  });

  it('shortfall_pct is zero when nominal_actual == target', () => {
    const r = computePayouts({
      capital: D('100000'),
      price: D('0.984833'),
      nominalTarget: D('101540.0581'),
      nominalActual: D('101540.0581'),
    });
    expect(r.shortfallPct.toFixed(6)).toBe('0.000000');
  });

  it('shortfall_pct returns 0 when nominalTarget is zero (no divide-by-zero)', () => {
    const r = computePayouts({
      capital: new Prisma.Decimal('0'),
      price: new Prisma.Decimal('1'),
      nominalTarget: new Prisma.Decimal('0'),
      nominalActual: new Prisma.Decimal('0'),
    });
    expect(r.shortfallPct.toFixed(6)).toBe('0.000000');
  });
});
