/**
 * Job contracts for the `pg-boss` queue (ADR-004).
 *
 * Shared here because the two ends of every job live in different apps:
 * `apps/web` publishes inside the booking transaction, `apps/worker` consumes.
 * A queue name or payload shape duplicated in both is a message that silently
 * stops being delivered the day one side is edited alone.
 *
 * **Payloads carry ids, never snapshots.** The worker refetches the
 * Booking → TimeSlot → Service → Organizer chain when it runs, so a job that
 * waited out a retry backoff still renders the current state — and neither
 * `manageToken` nor a login token (both password-equivalents, docs/domain.md)
 * is ever written to the `pgboss.job` table.
 */

import { z } from 'zod'

import { uuid } from './primitives'

/** Queue: a guest reserved seats. One job **per recipient** (see below). */
export const QUEUE_BOOKING_CREATED = 'booking.created'

/** Queue: a booking moved to `cancelled`, by either side. */
export const QUEUE_BOOKING_CANCELLED = 'booking.cancelled'

/**
 * Who a `booking.created` job is addressed to.
 *
 * Fanning out to one job per recipient rather than one job that sends twice is
 * what keeps a retry honest: a guest who never pressed Start on the bot is an
 * unreachable recipient, and re-running a combined handler would re-send to the
 * organizer every time that failed.
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
 *
 * Only `cancelledBy` is stored: the actor already saw the outcome on screen, so
 * the worker derives the single recipient by taking the counterparty.
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
