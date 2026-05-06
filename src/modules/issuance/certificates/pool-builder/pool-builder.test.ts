import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { fillPool, type EligibleOrder } from './pool-builder';

const D = (s: string) => new Prisma.Decimal(s);

function order(id: string, sum: string, externalId?: string): EligibleOrder {
  return {
    id,
    external_order_id: externalId ?? id,
    installments_sum: D(sum),
    merchant_id: 'm-1',
    num_installments: 3,
    max_due_date: new Date('2026-06-12'),
  };
}

describe('fillPool', () => {
  it('returns empty when eligible is empty', () => {
    const r = fillPool([], D('100'));
    expect(r.selected).toEqual([]);
    expect(r.nominalActual.toFixed(4)).toBe('0.0000');
  });

  it('adopts all when total fits target', () => {
    const r = fillPool([order('a', '50'), order('b', '40')], D('100'));
    expect(r.selected.map((o) => o.id)).toEqual(['a', 'b']);
    expect(r.nominalActual.toFixed(4)).toBe('90.0000');
  });

  it('skips a single oversized order and ends empty', () => {
    const r = fillPool([order('a', '500')], D('100'));
    expect(r.selected).toEqual([]);
    expect(r.nominalActual.toFixed(4)).toBe('0.0000');
  });

  it('respects greedy descending sort by installments_sum', () => {
    const r = fillPool([order('s', '10'), order('m', '40'), order('l', '90')], D('100'));
    // sorted DESC: l(90), m(40), s(10). l fits → 90. m: 90+40=130 > 100 → skip. s: 90+10=100 ≤ 100 → fit.
    expect(r.selected.map((o) => o.id)).toEqual(['l', 's']);
    expect(r.nominalActual.toFixed(4)).toBe('100.0000');
  });

  it('tie-breaks equal installments_sum by external_order_id ASC', () => {
    const r = fillPool([order('id-1', '50', 'ORD-Z'), order('id-2', '50', 'ORD-A')], D('200'));
    expect(r.selected.map((o) => o.external_order_id)).toEqual(['ORD-A', 'ORD-Z']);
  });

  it('exact fill: last order completes target', () => {
    const r = fillPool([order('a', '60'), order('b', '40')], D('100'));
    expect(r.nominalActual.toFixed(4)).toBe('100.0000');
    expect(r.selected.map((o) => o.id)).toEqual(['a', 'b']);
  });

  it('skip-and-continue: bigger does not fit, smaller does', () => {
    const r = fillPool([order('big', '70'), order('small', '20'), order('tiny', '5')], D('30'));
    // sorted: big(70) skip, small(20) fit → 20, tiny(5) → 25. Both small + tiny.
    expect(r.selected.map((o) => o.id)).toEqual(['small', 'tiny']);
    expect(r.nominalActual.toFixed(4)).toBe('25.0000');
  });

  it('is deterministic: same input → same output across runs', () => {
    const inputs = [order('a', '50'), order('b', '40'), order('c', '30')];
    const r1 = fillPool(inputs, D('100'));
    const r2 = fillPool(inputs, D('100'));
    expect(r1.selected.map((o) => o.id)).toEqual(r2.selected.map((o) => o.id));
  });
});
