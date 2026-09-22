import type { BookingRecord, GuestBooking } from '@repo/contracts'
import { hashManageToken } from '@repo/contracts/manage-token'
import type { Booking, Organizer, Service, TimeSlot } from '@repo/db'
import { bookings, db, organizers, services, timeSlots } from '@repo/db'
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm'

import { toPublicOrganizer } from './organizer'
import { toServiceRecord } from './service'
import { toTimeSlotRecord } from './time-slot'

import 'server-only'

/**
 * Server-side reads and DTO mapping for bookings.
 *
 * The write paths (create, cancel by token, cancel by owner) moved to
 * the Go API (`apps/web/pkg/db/booking.go`) together with the
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
 *
 * Paginated: `limit` (default 50) rows per page, `offset` for the page. The
 * cabinet table renders one page at a time rather than loading the whole
 * history into memory (Phase 2.2).
 */
export async function listBookings(
  organizerId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<BookingRecord[]> {
  const limit = options.limit ?? 50
  const offset = options.offset ?? 0
  const rows = await db
    .select()
    .from(bookings)
    .where(inArray(bookings.timeSlotId, ownedSlotIds(organizerId)))
    .orderBy(desc(bookings.createdAt))
    .limit(limit)
    .offset(offset)

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
  // Credential check goes through the hash (consolidated review P1):
  // the raw token column is not a lookup key anymore.
  const [row] = await guestBookingQuery()
    .where(eq(bookings.manageTokenHash, hashManageToken(token)))
    .limit(1)

  return row ? toGuestBooking(row) : null
}

/**
 * The raw analytics aggregates the cabinet page needs, computed in Postgres
 * rather than in JS memory (Phase 2.2). All windows are rolling relative to
 * `now` so the page stays correct at any hour of any day.
 *
 * Ownership is enforced by the same `ownedSlotIds` subquery as every other
 * read here — a booking reaches its service transitively, so the aggregate
 * joins through the slot.
 */
export interface AnalyticsAggregates {
  /** Confirmed bookings created in the last 30 days. */
  totalBookings: number
  /** Confirmed bookings created in the previous 30-day window. */
  prevTotalBookings: number
  /** Seats from confirmed bookings created in the last 30 days. */
  seatsSold: number
  /** Seats from confirmed bookings created in the previous 30-day window. */
  prevSeatsSold: number
  /** Total bookings (any status) in the last 30 days. */
  windowBookings: number
  /** Cancelled bookings in the last 30 days. */
  cancelledInWindow: number
  /** Per-day confirmed bookings/seats for the last 7 days (UTC date key). */
  trend: { day: string; bookings: number; seats: number }[]
  /** Per-service confirmed bookings in the window (service title → count). */
  byService: { service: string; bookings: number }[]
}

const WINDOW_DAYS = 30
const TREND_DAYS = 7

/**
 * Aggregate an organizer's bookings in Postgres. The headline counts and the
 * per-service breakdown are one grouped query; the 7-day trend is a second
 * grouped query. Both scope through `ownedSlotIds`, so an organizer can only
 * ever see their own data.
 */
export async function getAnalyticsSummary(
  organizerId: string,
  now: Date = new Date(),
): Promise<AnalyticsAggregates> {
  const windowStart = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const prevWindowStart = new Date(now.getTime() - 2 * WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const trendStart = new Date(now.getTime() - TREND_DAYS * 24 * 60 * 60 * 1000)
  // Drizzle's query cache hashes params with Buffer.from(), which
  // throws on Date objects — pass the boundaries as ISO strings
  // (Postgres compares timestamptz with string literals fine).
  const windowStartISO = windowStart.toISOString()
  const prevWindowStartISO = prevWindowStart.toISOString()
  const trendStartISO = trendStart.toISOString()

  const owned = ownedSlotIds(organizerId)

  // Headline counts + per-service breakdown in one pass over the window.
  const [headline, byServiceRows, trendRows] = await Promise.all([
    db
      .select({
        totalBookings: sql<number>`count(*) filter (where ${bookings.status} = 'confirmed' and ${bookings.createdAt} >= ${windowStartISO})`,
        prevTotalBookings: sql<number>`count(*) filter (where ${bookings.status} = 'confirmed' and ${bookings.createdAt} >= ${prevWindowStartISO} and ${bookings.createdAt} < ${windowStartISO})`,
        seatsSold: sql<number>`coalesce(sum(${bookings.seats}) filter (where ${bookings.status} = 'confirmed' and ${bookings.createdAt} >= ${windowStartISO}), 0)`,
        prevSeatsSold: sql<number>`coalesce(sum(${bookings.seats}) filter (where ${bookings.status} = 'confirmed' and ${bookings.createdAt} >= ${prevWindowStartISO} and ${bookings.createdAt} < ${windowStartISO}), 0)`,
        windowBookings: sql<number>`count(*) filter (where ${bookings.createdAt} >= ${windowStartISO})`,
        cancelledInWindow: sql<number>`count(*) filter (where ${bookings.status} = 'cancelled' and ${bookings.createdAt} >= ${windowStartISO})`,
      })
      .from(bookings)
      .where(inArray(bookings.timeSlotId, owned)),
    db
      .select({
        service: services.title,
        bookings: sql<number>`count(*)`,
      })
      .from(bookings)
      .innerJoin(timeSlots, eq(bookings.timeSlotId, timeSlots.id))
      .innerJoin(services, eq(timeSlots.serviceId, services.id))
      .where(
        and(
          inArray(bookings.timeSlotId, owned),
          eq(bookings.status, 'confirmed'),
          sql`${bookings.createdAt} >= ${windowStartISO}`,
        ),
      )
      .groupBy(services.title),
    db
      .select({
        day: sql<string>`to_char(${bookings.createdAt}, 'YYYY-MM-DD')`,
        bookings: sql<number>`count(*) filter (where ${bookings.status} = 'confirmed')`,
        seats: sql<number>`coalesce(sum(${bookings.seats}) filter (where ${bookings.status} = 'confirmed'), 0)`,
      })
      .from(bookings)
      .where(
        and(inArray(bookings.timeSlotId, owned), sql`${bookings.createdAt} >= ${trendStartISO}`),
      )
      .groupBy(sql`to_char(${bookings.createdAt}, 'YYYY-MM-DD')`),
  ])

  const byService = byServiceRows
    .map((row) => ({ service: row.service, bookings: Number(row.bookings) }))
    .sort((a, b) => b.bookings - a.bookings)

  // Fill the 7-day trend with zeroed buckets so the chart always has a point
  // per day even when nothing was booked.
  const byDay = new Map(trendRows.map((row) => [row.day, row]))
  const trend: AnalyticsAggregates['trend'] = []
  for (let i = TREND_DAYS - 1; i >= 0; i--) {
    const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
    const key = date.toISOString().slice(0, 10)
    const row = byDay.get(key)
    trend.push({
      day: date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
      bookings: row ? Number(row.bookings) : 0,
      seats: row ? Number(row.seats) : 0,
    })
  }

  const h = headline[0] ?? {
    totalBookings: 0,
    prevTotalBookings: 0,
    seatsSold: 0,
    prevSeatsSold: 0,
    windowBookings: 0,
    cancelledInWindow: 0,
  }

  return {
    totalBookings: Number(h.totalBookings),
    prevTotalBookings: Number(h.prevTotalBookings),
    seatsSold: Number(h.seatsSold),
    prevSeatsSold: Number(h.prevSeatsSold),
    windowBookings: Number(h.windowBookings),
    cancelledInWindow: Number(h.cancelledInWindow),
    trend,
    byService,
  }
}
