/** PostHog server client for the worker. No-op without key. Must flush on exit. */
import { PostHog } from 'posthog-node'

let client: PostHog | null = null

export function getPostHog(): PostHog | null {
  const key = process.env.POSTHOG_KEY
  if (!key) return null
  if (!client) {
    client = new PostHog(key, {
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://app.posthog.com',
    })
  }
  return client
}

/** Flush the queue on shutdown so the last batch is not lost. */
export async function shutdownPostHog(): Promise<void> {
  if (client) {
    await client.shutdown()
    client = null
  }
}
