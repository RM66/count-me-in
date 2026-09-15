import type { BookingRecord, GuestBooking } from '@repo/contracts'
import type { Booking, Organizer, Service, TimeSlot } from '@repo/db'
import { bookings, db, organizers, services, timeSlots } from '@repo/db'
import { and, count, desc, eq, inArray } from 'drizzle-orm'

import { toPublicOrganizer } from './organizer'
import { toServiceRecord } from './service'
import { toTimeSlotRecord } from './time-slot'

import 'server-only'

/**
 * Server-side reads and DTO mapping for bookings.
 *
 * The write paths (create, cancel by token, cancel by owner) moved to
 * the Go API (`apps/api-go/internal/db/booking.go`) together with the
 * route handlers — this module now serves only the pages that read
 * Postgres directly: the cabinet tables/analytics and the guest
 * booking management page.
 *
 * **Ownership is transitive.** There is no `organizerId` on `bookings`:
 * a booking belongs to a slot, the slot to a service, and the service
 * to an organizer (docs/domain.md). Every read here therefore scopes
 * through the parent chain with {@link ownedSlotIds} in the `WHERE`
 * clause.
 *
 * **Two audiences, two DTOs.** {@link toBookingRecord} is the organizer's view
 * and drops `manageToken`; {@link toGuestBooking} is the guest's own booking
 * and keeps it, because that token *is* their link to the management page.
 */

/**
 * Subquery of the slot ids an organizer owns (via their services).
 * Used as `timeSlotId IN (…)` so ownership is enforced by the same statement
 * that reads, in one round trip.
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
 * `manageToken` is deliberately dropped: it is the guest's cancellation secret,
 * and the cabinet must never see it (see `bookingRecord` in contracts).
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
 * Normalize a booking and its parent chain into the **guest's** DTO.
 * Keeps `manageToken` — this shape is only ever returned to the guest who owns
 * the booking, identified by that token.
 */
export function toGuestBooking(row: {
  booking: Booking
  slot: TimeSlot
  service: Service
  organizer: Organizer
}): GuestBooking {
  return {
    id: row.booking.id,
    status: row.booking.status,
    seats: row.booking.seats,
    guestName: row.booking.guestName,
    selectedOptions: row.booking.selectedOptions,
    createdAt: row.booking.createdAt.toISOString(),
    manageToken: row.booking.manageToken,
    slot: toTimeSlotRecord(row.slot),
    service: toServiceRecord(row.service),
    organizer: toPublicOrganizer(row.organizer),
  }
}

/**
 * The Booking → TimeSlot → Service → Organizer chain in one statement.
 * Every guest-facing read needs all four (docs/domain.md), and joining once
 * here keeps the "walk the chain" logic in a single place.
 */
function guestBookingQuery() {
  return db
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
}

/**
 * Every booking across an organizer's services, newest first.
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
 * One grouped query rather than a count per card — the same N+1 avoidance as
 * `countUpcomingSlots` in `service.ts`. Cancelled bookings are excluded.
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

/**
 * One booking by its `manageToken` — the deep link in the messenger message
 * (ADR-002, entry path 1). The token *is* the authorization: it was delivered
 * to the guest's verified messenger account, so no session is involved.
 * Returns `null` for an unknown token, which the page turns into a `404`.
 */
export async function getGuestBookingByToken(token: string): Promise<GuestBooking | null> {
  const [row] = await guestBookingQuery().where(eq(bookings.manageToken, token)).limit(1)

  return row ? toGuestBooking(row) : null
}
