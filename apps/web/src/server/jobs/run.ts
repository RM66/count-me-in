/**
 * Job dispatch — the one place a QStash delivery becomes a handler call.
 *
 * Owns the two policies every job shares:
 *
 * - **Payload validation.** A malformed body gets a `400`-class outcome
 *   (non-retryable — QStash would burn its budget re-sending the same bad
 *   bytes), so parsing happens here, against the schemas in
 *   `@repo/contracts`, before any handler runs.
 * - **Retry classification.** A handler error is rethrown for the route to
 *   answer `500` with, which is what makes QStash retry — except
 *   `TelegramUnreachableError`, which is absorbed with a log: a recipient who
 *   never pressed Start on the bot cannot be messaged now or in five minutes
 *   (docs/architecture.md), so the delivery is completed rather than retried.
 */

import {
  bookingCancelledJob,
  bookingCreatedJob,
  QUEUE_BOOKING_CANCELLED,
  QUEUE_BOOKING_CREATED,
  QUEUE_DEMO_REFRESH,
} from '@repo/contracts'
import * as Sentry from '@sentry/nextjs'
import { z } from 'zod'

import { handleBookingCancelled } from './booking-cancelled'
import { handleBookingCreated } from './booking-created'
import { refreshDemoSeed } from './demo-refresh'
import { readJobsEnv } from './env'
import { TelegramUnreachableError } from './telegram/client'

import 'server-only'

/** The `{queue}` path segment does not name a known job. */
export class UnknownJobQueueError extends Error {
  constructor(readonly queue: string) {
    super(`unknown job queue "${queue}"`)
    this.name = 'UnknownJobQueueError'
  }
}

/** The delivery's body does not parse / does not match the queue's schema. */
export class InvalidJobPayloadError extends Error {
  constructor(
    readonly queue: string,
    readonly cause: unknown,
  ) {
    super(`invalid payload for job queue "${queue}"`)
    this.name = 'InvalidJobPayloadError'
  }
}

/**
 * Run a handler, absorbing the one failure that must never be retried.
 * Letting it reach QStash would spend the retry budget and end in a dropped
 * message that reads like an outage; completing it with a log records the
 * truth — there was nobody to tell. The guest's on-screen success page, which
 * already carries the management link, is the designed fallback.
 */
async function runWithRetryPolicy(queue: string, run: () => Promise<void>): Promise<void> {
  try {
    await run()
  } catch (error) {
    if (error instanceof TelegramUnreachableError) {
      console.warn(`[${queue}] recipient unreachable — completing without retry:`, error.message)
      Sentry.captureException(error, { tags: { queue, unretriable: true } })
      return
    }
    throw error
  }
}

function parsePayload<T>(queue: string, schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw new InvalidJobPayloadError(queue, parsed.error)
  }
  return parsed.data
}

/**
 * Validate and run one QStash delivery.
 * `body` is the parsed JSON of the request (or `undefined` for an empty body —
 * the demo-refresh schedule sends no payload). Throws {@link UnknownJobQueueError}
 * for a foreign queue name and {@link InvalidJobPayloadError} for a malformed
 * payload; any other error is a handler failure the route answers `500` with,
 * which is what makes QStash retry.
 */
export async function runJob(queue: string, body: unknown): Promise<void> {
  switch (queue) {
    case QUEUE_BOOKING_CREATED: {
      const job = parsePayload(QUEUE_BOOKING_CREATED, bookingCreatedJob, body)
      const env = readJobsEnv()
      return runWithRetryPolicy(queue, () => handleBookingCreated(env, job))
    }
    case QUEUE_BOOKING_CANCELLED: {
      const job = parsePayload(QUEUE_BOOKING_CANCELLED, bookingCancelledJob, body)
      const env = readJobsEnv()
      return runWithRetryPolicy(queue, () => handleBookingCancelled(env, job))
    }
    case QUEUE_DEMO_REFRESH: {
      // A failure escapes as a 500 so QStash retries; capture it with the
      // queue tag here, since the route's rethrow is tagged by instrumentation
      // without the queue name.
      try {
        return await refreshDemoSeed()
      } catch (error) {
        Sentry.captureException(error, { tags: { queue } })
        throw error
      }
    }
    default:
      throw new UnknownJobQueueError(queue)
  }
}
