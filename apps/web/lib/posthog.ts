/** PostHog browser client. Lazy singleton, no-op without key. Replay masks inputs (no PII). */
import posthog from 'posthog-js'

let initialized = false

export function initPostHog(): void {
  if (initialized) return
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
  if (!key) return

  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://app.posthog.com',
    capture_pageview: true,
    persistence: 'localStorage+cookie',
    session_recording: { maskAllInputs: true },
  })

  initialized = true
}

/** Identify a signed-in organizer. Guests stay anonymous — their identity is PII. */
export function identifyOrganizer(organizerId: string): void {
  if (!initialized) return
  posthog.identify(organizerId)
}

export function resetPostHog(): void {
  if (!initialized) return
  posthog.reset()
}

export { posthog }
