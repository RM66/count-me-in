/** Sentry client-side init (consolidated review P1-7).
 *
 * Next 16 runs on Turbopack, where the legacy `sentry.client.config.ts`
 * at the project root is deprecated and silently ignored — client errors
 * were not reported. The supported location is `src/instrumentation-client.ts`.
 * No-op without DSN. Replay off — PostHog covers it.
 */
import * as Sentry from '@sentry/nextjs'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  })
}

// Required by the Sentry SDK to instrument client-side navigations.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
