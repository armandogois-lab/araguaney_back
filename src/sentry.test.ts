import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Sentry from '@sentry/node';
import { initSentry } from './sentry';

vi.mock('@sentry/node', () => ({
  init: vi.fn(),
}));

describe('initSentry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes Sentry when DSN is provided', () => {
    initSentry('https://abc@o123.ingest.sentry.io/456', 'production');
    expect(Sentry.init).toHaveBeenCalledWith({
      dsn: 'https://abc@o123.ingest.sentry.io/456',
      environment: 'production',
      tracesSampleRate: 0,
      profilesSampleRate: 0,
    });
  });

  it('is a no-op when DSN is undefined', () => {
    initSentry(undefined, 'development');
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('is a no-op when DSN is empty string', () => {
    initSentry('', 'development');
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('is a no-op when DSN is whitespace only', () => {
    initSentry('   ', 'production');
    expect(Sentry.init).not.toHaveBeenCalled();
  });
});
