import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateExternalCode } from './external-code-generator';

describe('generateExternalCode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 4, 6, 10, 32, 45)));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats with B-YYYYMMDD-HHmmss using UTC', () => {
    expect(generateExternalCode()).toBe('B-20260506-103245');
  });

  it('produces 17 chars and stays within varchar(20)', () => {
    const code = generateExternalCode();
    expect(code).toHaveLength(17);
    expect(code.length).toBeLessThanOrEqual(20);
  });
});
