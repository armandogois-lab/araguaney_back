import { describe, it, expect } from 'vitest';
import { isoWeek } from './iso-week';

describe('isoWeek', () => {
  it('returns 2026-W18 for 2026-04-27 (Monday)', () => {
    expect(isoWeek(new Date(Date.UTC(2026, 3, 27)))).toBe('2026-W18');
  });

  it('returns 2026-W24 for 2026-06-08 (Monday)', () => {
    expect(isoWeek(new Date(Date.UTC(2026, 5, 8)))).toBe('2026-W24');
  });

  it('handles year-boundary: 2024-12-30 (Mon) is week 2025-W01', () => {
    expect(isoWeek(new Date(Date.UTC(2024, 11, 30)))).toBe('2025-W01');
  });

  it('handles year-boundary: 2027-01-03 (Sun) belongs to 2026-W53', () => {
    expect(isoWeek(new Date(Date.UTC(2027, 0, 3)))).toBe('2026-W53');
  });
});
