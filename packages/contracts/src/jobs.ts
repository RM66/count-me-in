/**
 * Job contracts for the Upstash QStash queue (ADR-012, supersedes ADR-004).
 *
 * Shared here because the two ends of every job are written against the same
 * wire: `apps/web` publishes after the booking transaction commits, QStash
 * delivers to `POST /api/jobs/{queue}` in the same app, and the dispatch layer
 * validates the payload against these schemas. A queue name or payload shape
 * duplicated on both sides would silently stop delivering the day one side is
 * edited alone.
 *
 * **Payloads carry ids, never snapshots.** The job handler refetches the
 * Booking → TimeSlot → Service → Organizer chain when it runs, so a job that
 * waited out a retry backoff still renders the current state.
 */

import { z } from 'zod'

import { uuid } from './primitives'

/**
 * Queue: a guest reserved seats. One job **per recipient**.
 * The value is the `{queue}` segment of the receiver route — the publisher
 * builds the QStash destination URL from it.
 */
export const QUEUE_BOOKING_CREATED = 'booking.created'

/** Queue: a booking moved to `cancelled`, by either side. */
export const QUEUE_BOOKING_CANCELLED = 'booking.cancelled'

/**
 * Queue: recurring demo seed refresh (ADR-010).
 * Not published by any request handler — a QStash **schedule** (cron) is its
 * only producer; see `apps/web/scripts/ensure-qstash.ts`.
 */
export const QUEUE_DEMO_REFRESH = 'demo.refresh'

/**
 * How often the demo seed refreshes: daily, shortly after midnight UTC.
 * Off the hour to stay out of the crowd of cron jobs that fire at :00, and
 * daily because the seed lays out slots across the coming days — anything
 * rarer would let the earliest ones expire.
 */
export const DEMO_REFRESH_CRON = '17 0 * * *'

/**
 * Who a `booking.created` job is addressed to.
 * Fanning out to one job per recipient keeps a retry honest: an unreachable
 * recipient (never pressed Start) should not re-send to the organizer.
 */
export const notificationRecipientEnum = z.enum(['organizer', 'guest'])
export type NotificationRecipient = z.infer<typeof notificationRecipientEnum>

/** Which side cancelled — the *other* one is the party that gets notified. */
export const cancelActorEnum = z.enum(['guest', 'organizer'])
export type CancelActor = z.infer<typeof cancelActorEnum>

/** Payload of a {@link QUEUE_BOOKING_CREATED} job. */
export const bookingCreatedJob = z.object({
  bookingId: uuid,
  recipient: notificationRecipientEnum,
})
export type BookingCreatedJob = z.infer<typeof bookingCreatedJob>

/**
 * Payload of a {@link QUEUE_BOOKING_CANCELLED} job.
 * Only `cancelledBy` is stored; the handler derives the single recipient by
 * taking the counterparty.
 */
export const bookingCancelledJob = z.object({
  bookingId: uuid,
  cancelledBy: cancelActorEnum,
})
export type BookingCancelledJob = z.infer<typeof bookingCancelledJob>

/** The party to notify about a cancellation: whoever did not perform it. */
export function cancelNotificationRecipient(cancelledBy: CancelActor): NotificationRecipient {
  return cancelledBy === 'guest' ? 'organizer' : 'guest'
}
