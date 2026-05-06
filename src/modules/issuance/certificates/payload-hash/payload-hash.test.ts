import { describe, it, expect } from 'vitest';
import { computePayloadHash, type PayloadHashInput } from './payload-hash';

function input(overrides: Partial<PayloadHashInput> = {}): PayloadHashInput {
  return {
    inputs: {
      capital: '100000.0000',
      rate: '0.130000',
      term_days: 42,
      issue_date: '2026-04-27',
      investor_id: '00000000-0000-4000-8000-000000000001',
    },
    outputs: {
      price: '0.984833',
      nominal_target: '101540.0581',
      nominal_actual: '101540.0034',
      investor_paid: '99999.9462',
      investor_returned: '0.0538',
      investor_yield: '1540.0572',
      shortfall_pct: '0.000001',
    },
    order_ids: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'],
    ...overrides,
  };
}

describe('computePayloadHash', () => {
  it('returns 64-char lowercase hex', () => {
    const h = computePayloadHash(input());
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic across runs', () => {
    const a = computePayloadHash(input());
    const b = computePayloadHash(input());
    expect(a).toBe(b);
  });

  it('canonicalizes order_ids by sorting before hashing', () => {
    const reversed: PayloadHashInput = {
      ...input(),
      order_ids: ['22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111'],
    };
    expect(computePayloadHash(input())).toBe(computePayloadHash(reversed));
  });

  it('produces different hashes when inputs.capital changes', () => {
    const changed = input({ inputs: { ...input().inputs, capital: '200000.0000' } });
    expect(computePayloadHash(input())).not.toBe(computePayloadHash(changed));
  });
});
