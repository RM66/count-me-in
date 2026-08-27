/**
 * QStash publisher — the web app's end of the job queue (ADR-012).
 *
 * Publishing is an HTTPS call to Upstash, so it **cannot join the Postgres
 * transaction** the way the old pg-boss insert did. The contract is therefore
 * *publish-after-commit*: callers run these functions once the booking
 * transaction has returned — inside `after()` so the guest's response is not
 * delayed by the round trip. QStash owns delivery from there: at-least-once,
 * 5 retries with exponential backoff, mirroring the old queue policy.
 *
 * **Fire-and-forget.** Both functions catch their own errors and report them
 * (console + Sentry) instead of throwing: they run in `after()` where nobody
 * is left to handle a rejection, and a notification must never fail a request
 * whose booking already committed. The accepted loss window is a crash between
 * commit and publish (ADR-012).
 *
 * Dev without `QSTASH_TOKEN`: publishing is skipped with a one-time warning —
 * local deliveries would be unreachable anyway, since QStash POSTs to
 * `APP_URL` and localhost is not routable from Upstash.
 */

import {
  type BookingCancelledJob,
  type BookingCreatedJob,
  type CancelActor,
  QUEUE_BOOKING_CANCELLED,
  QUEUE_BOOKING_CREATED,
} from '@repo/contracts'
import * as Sentry from '@sentry/nextjs'
import { Client } from '@upstash/qstash'

import 'server-only'

/**
 * How hard QStash tries before dropping a message: 5 delivery attempts with
 * exponential backoff. Matches the old pg-boss `retryLimit`. Permanent
 * failures (the recipient never pressed Start) are completed by the receiver
 * with a `200`, so they never spend this budget.
 */
const JOB_RETRIES = 5

let warnedAboutMissingToken = false

/**
 * A lazily built client, or `null` in a dev environment without a token.
 * Production without `QSTASH_TOKEN` still throws — a silent no-op there would
 * lose every notification to a misconfiguration.
 */
function getClient(): Client | null {
  const token = process.env.QSTASH_TOKEN

  if (!token) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('QSTASH_TOKEN is not set')
    }
    if (!warnedAboutMissingToken) {
      warnedAboutMissingToken = true
      console.warn('[queue] QSTASH_TOKEN is not set — skipping notification publish (dev only)')
    }
    return null
  }

  // `baseUrl` is passed explicitly rather than left to the SDK's env fallback:
  // a regional instance (e.g. https://qstash-eu-central-1.upstash.io) must be
  // addressed directly, and relying on the SDK to read QSTASH_URL is an
  // implicit contract that would silently break delivery if it ever changed.
  return new Client({ token, baseUrl: process.env.QSTASH_URL })
}

/** The QStash destination for a queue: the receiver route in this deployment. */
function destination(queue: string): string {
  const appUrl = process.env.APP_URL?.replace(/\/+$/, '')
  if (!appUrl) {
    throw new Error('APP_URL is not set')
  }
  return `${appUrl}/api/jobs/${queue}`
}

async function publish(queue: string, job: BookingCreatedJob | BookingCancelledJob): Promise<void> {
  try {
    const client = getClient()
    if (!client) return

    await client.publishJSON({ url: destination(queue), body: job, retries: JOB_RETRIES })
  } catch (error) {
    console.error(`[queue] failed to publish ${queue} job:`, error)
    Sentry.captureException(error, { tags: { queue, source: 'qstash-publish' } })
  }
}

/**
 * Publish the two `booking.created` notifications for a fresh booking.
 * **Call after the booking transaction commits, not inside it.**
 * One job **per recipient** — see the fan-out note in `contracts/jobs.ts`.
 */
export async function publishBookingCreated(bookingId: string): Promise<void> {
  const jobs: BookingCreatedJob[] = [
    { bookingId, recipient: 'organizer' },
    { bookingId, recipient: 'guest' },
  ]

  await Promise.all(jobs.map((job) => publish(QUEUE_BOOKING_CREATED, job)))
}

/**
 * Publish the `booking.cancelled` notification for a cancelled booking.
 * Same after-commit contract as {@link publishBookingCreated}. Only the actor
 * is recorded; the receiver notifies the counterparty.
 */
export async function publishBookingCancelled(
  bookingId: string,
  cancelledBy: CancelActor,
): Promise<void> {
  const job: BookingCancelledJob = { bookingId, cancelledBy }

  await publish(QUEUE_BOOKING_CANCELLED, job)
}
