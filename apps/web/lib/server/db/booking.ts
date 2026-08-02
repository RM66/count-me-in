/**
 * Server-side reads and DTO mapping for bookings.
 *
 * Cabinet pages are server components that query Postgres directly, while
 * future route handlers return the same shape over HTTP — both go through
 * {@link toBookingRecord} so the client only ever sees one contract.
 *
 * **Ownership is transitive.** There is no `organizerId` on `bookings`: a
 * booking belongs to a slot, the slot to a service, and the service to an
 * organizer (docs/domain.md). Every read here therefore scopes through the
 * parent chain with {@link ownedSlotIds} in the `WHERE` clause, so a foreign id
 * matches no row.
 *
 * Writes (guest create/cancel, organizer cancel) are the booking flow's atomic
 * reserve/release and will live here too when those endpoints land.
 */

import type { BookingRecord } from '@repo/api-contracts'
import type { Booking } from '@repo/db'
import { bookings, db, services, timeSlots } from '@repo/db'
import { and, count, desc, eq, inArray } from 'drizzle-orm'

import 'server-only'

/**
 * Subquery of the slot ids an organizer owns (via their services).
 *
 * Used as `timeSlotId IN (…)` so ownership is enforced by the same statement
 * that reads, in one round trip — the pattern `time-slot.ts` uses one level up.
 */
function ownedSlotIds(organizerId: string) {
  return db
    .select({ id: timeSlots.id })
    .from(timeSlots)
    .innerJoin(services, eq(timeSlots.serviceId, services.id))
    .where(eq(services.organizerId, organizerId))
}

/**
 * Normalize a `bookings` row into the API/DTO shape (dates → ISO strings).
 *
 * `manageToken` is deliberately dropped: it is the guest's cancellation secret,
 * and the cabinet must never see it (see `bookingRecord` in api-contracts).
 */
export function toBookingRecord(row: Booking): BookingRecord {
  return {
    id: row.id,
    timeSlotId: row.timeSlotId,
    status: row.status,
    seats: row.seats,
    guestName: row.guestName,
    guestMessenger: row.guestMessenger,
    guestMessengerId: row.guestMessengerId,
    guestMessengerLogin: row.guestMessengerLogin,
    selectedOptions: row.selectedOptions,
    createdAt: row.createdAt.toISOString(),
  }
}

/**
 * Every booking across an organizer's services, newest first.
 *
 * Cancelled bookings are included — the cabinet table filters by status
 * client-side, and hiding them here would make a guest's cancellation look
 * like data loss.
 */
export async function listBookings(organizerId: string): Promise<BookingRecord[]> {
  const rows = await db
    .select()
    .from(bookings)
    .where(inArray(bookings.timeSlotId, ownedSlotIds(organizerId)))
    .orderBy(desc(bookings.createdAt))

  return rows.map(toBookingRecord)
}

/**
 * Number of *confirmed* bookings per service id, for the cabinet services list.
 *
 * One grouped query rather than a count per card — the same N+1 avoidance as
 * `countUpcomingSlots` in `service.ts`. Cancelled bookings are excluded: the
 * card advertises live demand, and a count inflated by cancellations would
 * disagree with the seats actually taken.
 */
export async function countConfirmedBookings(
  serviceIds: string[],
): Promise<Record<string, number>> {
  if (serviceIds.length === 0) return {}

  const rows = await db
    .select({ serviceId: timeSlots.serviceId, total: count() })
    .from(bookings)
    .innerJoin(timeSlots, eq(bookings.timeSlotId, timeSlots.id))
    .where(and(inArray(timeSlots.serviceId, serviceIds), eq(bookings.status, 'confirmed')))
    .groupBy(timeSlots.serviceId)

  return Object.fromEntries(rows.map((row) => [row.serviceId, Number(row.total)]))
}
