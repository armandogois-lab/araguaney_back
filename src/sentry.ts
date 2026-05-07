import * as Sentry from '@sentry/node';

export function initSentry(dsn: string | undefined, env: string): void {
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: env,
    tracesSampleRate: 0,
    profilesSampleRate: 0,
  });
}
