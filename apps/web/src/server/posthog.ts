/**
 * PostHog server client for server-side events (notification sends).
 * No-op without `POSTHOG_KEY`.
 *
 * Unlike the old long-lived worker, this runs inside serverless functions that
 * may freeze the moment a response is sent, so the client flushes after every
 * event (`flushAt: 1`) instead of batching — the volume is one event per
 * notification, so the extra request costs nothing and loses nothing.
 */

import { PostHog } from 'posthog-node'

import 'server-only'

let client: PostHog | null = null

export function getPostHog(): PostHog | null {
  const key = process.env.POSTHOG_KEY
  if (!key) return null
  if (!client) {
    client = new PostHog(key, {
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://app.posthog.com',
      flushAt: 1,
    })
  }
  return client
}
