import { describe, it, expect } from 'vitest';
import { normalizeRif, isValidRif } from './rif-normalizer';

describe('normalizeRif', () => {
  it('canonicalizes already-formatted RIF', () => {
    expect(normalizeRif('J-12345678-9')).toBe('J-12345678-9');
  });

  it('uppercases prefix and pads digits', () => {
    expect(normalizeRif('j-1234567-8')).toBe('J-01234567-8');
  });

  it('inserts hyphens when missing', () => {
    expect(normalizeRif('J123456789')).toBe('J-12345678-9');
  });

  it('strips internal whitespace', () => {
    expect(normalizeRif(' J - 12345678 - 9 ')).toBe('J-12345678-9');
  });

  it('accepts V/E/J/G/P prefixes', () => {
    expect(normalizeRif('V123456789')).toBe('V-12345678-9');
    expect(normalizeRif('E123456789')).toBe('E-12345678-9');
    expect(normalizeRif('G123456789')).toBe('G-12345678-9');
    expect(normalizeRif('P123456789')).toBe('P-12345678-9');
  });

  it('returns null for invalid format', () => {
    expect(normalizeRif('foo')).toBeNull();
    expect(normalizeRif('J-12-34')).toBeNull();
    expect(normalizeRif('')).toBeNull();
  });
});

describe('isValidRif', () => {
  it('returns true for normalizable RIF', () => {
    expect(isValidRif('J123456789')).toBe(true);
  });
  it('returns false for garbage', () => {
    expect(isValidRif('xxx')).toBe(false);
  });
});
