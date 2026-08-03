/**
 * The rows a notification needs, fetched by booking id.
 *
 * Jobs carry only ids (see `api-contracts/jobs.ts`), so every handler starts
 * here. Deliberately a *fresh* read at send time: a job that waited out a retry
 * backoff — or sat in the queue while the worker was down — must render the
 * booking as it is now, not as it was when the transaction committed.
 *
 * The chain is walked in one statement because all four rows are always needed
 * together: the organizer supplies the timezone every instant is rendered in
 * and the chat to notify, the service its title and display overrides, the slot
 * the time, the booking the guest and their `manageToken`.
 *
 * This mirrors the join in `apps/web/lib/server/db/booking.ts` rather than
 * importing it: that module is `server-only` and app-local by design (ADR-001),
 * so the worker talks to `@repo/db` directly.
 */

import type { Booking, Organizer, Service, TimeSlot } from '@repo/db'
import { bookings, db, organizers, services, timeSlots } from '@repo/db'
import { eq } from 'drizzle-orm'

export interface NotificationContext {
  booking: Booking
  slot: TimeSlot
  service: Service
  organizer: Organizer
}

/** The Booking → TimeSlot → Service → Organizer chain, or `null` if it is gone. */
export async function getNotificationContext(
  bookingId: string,
): Promise<NotificationContext | null> {
  const [row] = await db
    .select({
      booking: bookings,
      slot: timeSlots,
      service: services,
      organizer: organizers,
    })
    .from(bookings)
    .innerJoin(timeSlots, eq(bookings.timeSlotId, timeSlots.id))
    .innerJoin(services, eq(timeSlots.serviceId, services.id))
    .innerJoin(organizers, eq(services.organizerId, organizers.id))
    .where(eq(bookings.id, bookingId))
    .limit(1)

  return row ?? null
}
