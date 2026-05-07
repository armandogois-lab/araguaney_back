import * as Sentry from '@sentry/node';

export function initSentry(dsn: string | undefined, env: string): void {
  if (!dsn || dsn.trim() === '') return;
  Sentry.init({
    dsn: dsn.trim(),
    environment: env,
    tracesSampleRate: 0,
    profilesSampleRate: 0,
  });
}
