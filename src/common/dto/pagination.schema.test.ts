import { describe, it, expect } from 'vitest';
import { PaginationSchema } from './pagination.schema';

describe('PaginationSchema', () => {
  it('applies defaults limit=50, offset=0 when empty', () => {
    expect(PaginationSchema.parse({})).toEqual({ limit: 50, offset: 0 });
  });

  it('coerces string numbers from query params', () => {
    expect(PaginationSchema.parse({ limit: '25', offset: '100' })).toEqual({
      limit: 25,
      offset: 100,
    });
  });

  it('rejects limit > 200', () => {
    expect(() => PaginationSchema.parse({ limit: 201 })).toThrow();
  });

  it('rejects negative offset', () => {
    expect(() => PaginationSchema.parse({ offset: -1 })).toThrow();
  });

  it('rejects limit < 1', () => {
    expect(() => PaginationSchema.parse({ limit: 0 })).toThrow();
  });
});
