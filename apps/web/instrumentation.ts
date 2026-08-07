/**
 * Sentry server-side init. Root-level convention — do not move.
 * No-op without `SENTRY_DSN`.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (!process.env.SENTRY_DSN) return

  const Sentry = await import('@sentry/nextjs')

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1, // 10% — tune up for deeper coverage.
    // Replay is PostHog's job; keep Sentry replay off to avoid double payload cost.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  })
}
