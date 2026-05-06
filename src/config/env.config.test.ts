import { describe, it, expect } from 'vitest';
import { envSchema } from './env.config';

describe('envSchema', () => {
  const valid = {
    DATABASE_URL: 'postgresql://u:p@h:6543/db',
    DIRECT_URL: 'postgresql://u:p@h:5432/db',
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_ANON_KEY: 'a',
    SUPABASE_SERVICE_ROLE_KEY: 's',
    SUPABASE_JWT_SECRET: 'j',
  };

  it('parses a minimal valid env with defaults', () => {
    const r = envSchema.parse(valid);
    expect(r.NODE_ENV).toBe('development');
    expect(r.PORT).toBe(3001);
    expect(r.LOG_LEVEL).toBe('info');
    expect(r.CORS_ORIGINS).toEqual(['http://localhost:3000']);
  });

  it('rejects missing DATABASE_URL', () => {
    const { DATABASE_URL: _DATABASE_URL, ...bad } = valid;
    expect(() => envSchema.parse(bad)).toThrow();
  });

  it('rejects missing DIRECT_URL', () => {
    const { DIRECT_URL: _DIRECT_URL, ...bad } = valid;
    expect(() => envSchema.parse(bad)).toThrow();
  });

  it('rejects non-numeric PORT', () => {
    expect(() => envSchema.parse({ ...valid, PORT: 'abc' })).toThrow();
  });

  it('rejects unknown LOG_LEVEL', () => {
    expect(() => envSchema.parse({ ...valid, LOG_LEVEL: 'loud' })).toThrow();
  });

  it('parses CORS_ORIGINS as comma-separated list with whitespace stripped', () => {
    const r = envSchema.parse({ ...valid, CORS_ORIGINS: 'http://a, http://b ,http://c' });
    expect(r.CORS_ORIGINS).toEqual(['http://a', 'http://b', 'http://c']);
  });

  it('rejects empty SUPABASE_SERVICE_ROLE_KEY', () => {
    expect(() => envSchema.parse({ ...valid, SUPABASE_SERVICE_ROLE_KEY: '' })).toThrow();
  });
});
