import { randomBytes } from 'node:crypto'
import type { BookingRecord, GuestBooking, Messenger } from '@repo/api-contracts'
import { buildSelectedOptionsSchema } from '@repo/api-contracts'
import type { Booking, Organizer, Service, TimeSlot } from '@repo/db'
import { bookings, db, organizers, services, timeSlots } from '@repo/db'
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm'

import { assertNotDemo } from '../demo'
import { enqueueBookingCancelled, enqueueBookingCreated } from '../queue'
import { toPublicOrganizer } from './organizer'
import { toServiceRecord } from './service'
import { toTimeSlotRecord } from './time-slot'

import 'server-only'

/**
 * Postgres SQLSTATE for a unique constraint violation — the code the
 * `postgres` driver puts on the error when a unique index rejects an insert.
 */
const UNIQUE_VIOLATION = '23505'

/**
 * Narrow to a Postgres unique violation (`23505`). The `postgres` driver can
 * surface it directly or wrapped in a generic `Error` with the real error in
 * `cause` — both are checked.
 */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false

  if ('code' in error && (error as { code: unknown }).code === UNIQUE_VIOLATION) {
    return true
  }

  const cause = (error as { cause?: unknown }).cause
  return (
    cause !== null &&
    typeof cause === 'object' &&
    'code' in cause &&
    (cause as { code: unknown }).code === UNIQUE_VIOLATION
  )
}

/**
 * Server-side reads, writes and DTO mapping for bookings.
 *
 * Cabinet pages are server components that query Postgres directly, while the
 * route handlers return the same shape over HTTP — both go through
 * {@link toBookingRecord} so the client only ever sees one contract.
 *
 * **Ownership is transitive.** There is no `organizerId` on `bookings`: a
 * booking belongs to a slot, the slot to a service, and the service to an
 * organizer (docs/domain.md). Every read here therefore scopes through the
 * parent chain with {@link ownedSlotIds} in the `WHERE` clause.
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
 * Normalize a booking and its parent chain into the **guest's** DTO.
 * Keeps `manageToken` — this shape is only ever returned to the guest who owns
 * the booking, identified either by that token or by a server-validated ticket.
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

// ── Guest-facing reads ───────────────────────────────────────────────────────

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

/**
 * Every booking of one messenger identity, newest first (ADR-002, entry path 2).
 * The identity comes from a server-validated ticket, never from client input
 * (invariant 8). Cancelled bookings are included: a guest looking for "my
 * bookings" is often checking whether a cancellation went through.
 */
export async function listGuestBookings(
  messenger: Messenger,
  messengerId: string,
): Promise<GuestBooking[]> {
  const rows = await guestBookingQuery()
    .where(and(eq(bookings.guestMessenger, messenger), eq(bookings.guestMessengerId, messengerId)))
    .orderBy(desc(bookings.createdAt))

  return rows.map(toGuestBooking)
}

// ── Guest-facing writes ──────────────────────────────────────────────────────
//
// **Notifications are enqueued inside these transactions**, never after them:
// a job published post-commit can be lost if the process dies in between, and
// one published pre-commit on its own connection can notify about a booking
// that then rolls back. `lib/server/queue.ts` routes the insert through the
// caller's `tx` so the job and the row share a fate (ADR-004).
//
// Demo bookings never reach the queue: `assertNotDemo` runs before the write in
// every path below (ADR-010).

/** Raised when the slot no longer has room for the requested seats. */
export class SlotSoldOutError extends Error {
  constructor(readonly seatsLeft: number) {
    super(
      seatsLeft === 0
        ? 'This session is fully booked'
        : `Only ${seatsLeft} ${seatsLeft === 1 ? 'seat' : 'seats'} left on this session`,
    )
    this.name = 'SlotSoldOutError'
  }
}

/** Raised when the requested slot does not exist, or not under the given service. */
export class SlotNotBookableError extends Error {
  constructor(message = 'This session is no longer available') {
    super(message)
    this.name = 'SlotNotBookableError'
  }
}

/** Raised when `selectedOptions` is not a valid selection for the service (invariant 6). */
export class InvalidOptionSelectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidOptionSelectionError'
  }
}

/**
 * Raised when a booking requests more seats than the service allows one guest
 * to claim at once (`services.maxSeatsPerBooking`). This is the organizer's
 * per-booking cap — distinct from {@link SlotSoldOutError}, which is about the
 * slot running out of room. Checked server-side so a crafted request cannot
 * bypass the stepper's client-side limit.
 */
export class PartyTooLargeError extends Error {
  constructor(readonly maxSeats: number) {
    super(
      `You can book at most ${maxSeats} ${maxSeats === 1 ? 'seat' : 'seats'} in a single booking`,
    )
    this.name = 'PartyTooLargeError'
  }
}

/** Raised when a booking is already `cancelled` and cancel is called again. */
export class BookingAlreadyCancelledError extends Error {
  constructor() {
    super('This booking has already been cancelled')
    this.name = 'BookingAlreadyCancelledError'
  }
}

/**
 * Raised when the guest already has a `confirmed` booking on the same slot.
 * The partial unique index (`WHERE status = 'confirmed'`) rejects the second
 * INSERT with a `23505`; this class lets the route handler answer `409`.
 * Cancelling and re-booking is allowed — only a second active booking is refused.
 */
export class DuplicateBookingError extends Error {
  constructor() {
    super('You already have a booking for this session')
    this.name = 'DuplicateBookingError'
  }
}

/**
 * Bytes of entropy behind a `manageToken`.
 * The token is the only credential guarding `/booking/{manageToken}`, so it is
 * sized to be unguessable rather than short — it is never typed by hand.
 */
const MANAGE_TOKEN_BYTES = 32

/**
 * Fresh `manageToken` for a new booking.
 * Generated here rather than accepted as a parameter: a caller that forgot it,
 * or derived it from something predictable, would hand out the ability to cancel
 * someone else's booking.
 *
 * MVP stores it as-is, matching the demo seed (`packages/db/src/seed/demo.ts`);
 * docs/domain.md calls for hashing at rest, which is a follow-up.
 */
function newManageToken(): string {
  return randomBytes(MANAGE_TOKEN_BYTES).toString('base64url')
}

/**
 * Reserve seats and insert the `confirmed` booking — the guest booking flow's
 * one write (invariant 2 in docs/domain.md).
 *
 * The seat claim is a **single conditional UPDATE**:
 *
 * ```sql
 * UPDATE time_slots SET booked_count = booked_count + :seats
 * WHERE id = :id AND booked_count + :seats <= capacity
 * ```
 *
 * Postgres evaluates the predicate against the row it locks, so two concurrent
 * bookings for the last seat cannot both succeed — one updates no row and is
 * refused. Reading `bookedCount`, comparing it in JS and writing it back would
 * reopen exactly that race.
 *
 * The booking row is inserted **only** if that statement affected a row, and
 * both live in one transaction: a claimed seat with no booking would be capacity
 * lost forever, and a booking with no claim is an overbooking.
 *
 * A duplicate (same guest, same slot, already `confirmed`) is caught at the
 * INSERT by the partial unique index (invariant 4). The transaction rolls back,
 * releasing the claimed seat, and the `23505` is rethrown as a
 * {@link DuplicateBookingError} for a `409`.
 */
export async function createGuestBooking(input: {
  serviceId: string
  timeSlotId: string
  seats: number
  guestName: string
  selectedOptions?: string[]
  guest: { messenger: Messenger; messengerId: string; messengerLogin?: string }
}): Promise<GuestBooking> {
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ slot: timeSlots, service: services, organizer: organizers })
      .from(timeSlots)
      .innerJoin(services, eq(timeSlots.serviceId, services.id))
      .innerJoin(organizers, eq(services.organizerId, organizers.id))
      .where(and(eq(timeSlots.id, input.timeSlotId), eq(services.id, input.serviceId)))
      .limit(1)

    if (!target) {
      throw new SlotNotBookableError()
    }

    assertNotDemo(target.organizer.id)

    const options = buildSelectedOptionsSchema(target.service).safeParse(input.selectedOptions)
    if (!options.success) {
      throw new InvalidOptionSelectionError(
        options.error.issues[0]?.message ?? 'Invalid option selection',
      )
    }

    // Organizer's per-booking cap. Enforced before the atomic reserve so an
    // oversized party is refused outright rather than competing for seats.
    // `seatsLeft` (below) still governs whether an allowed party actually fits.
    if (input.seats > target.service.maxSeatsPerBooking) {
      throw new PartyTooLargeError(target.service.maxSeatsPerBooking)
    }

    const [claimed] = await tx
      .update(timeSlots)
      .set({ bookedCount: sql`${timeSlots.bookedCount} + ${input.seats}` })
      .where(
        and(
          eq(timeSlots.id, input.timeSlotId),
          sql`${timeSlots.bookedCount} + ${input.seats} <= ${timeSlots.capacity}`,
        ),
      )
      .returning()

    if (!claimed) {
      throw new SlotSoldOutError(Math.max(0, target.slot.capacity - target.slot.bookedCount))
    }

    let created: typeof bookings.$inferSelect
    try {
      const [row] = await tx
        .insert(bookings)
        .values({
          timeSlotId: claimed.id,
          status: 'confirmed',
          seats: input.seats,
          guestName: input.guestName,
          guestMessenger: input.guest.messenger,
          guestMessengerId: input.guest.messengerId,
          guestMessengerLogin: input.guest.messengerLogin ?? null,
          manageToken: newManageToken(),
          selectedOptions: options.data,
        })
        .returning()

      if (!row) {
        throw new SlotNotBookableError('Could not create the booking — try again')
      }
      created = row
    } catch (error) {
      // Duplicate booking — the transaction rolls back, releasing the claimed seat.
      if (isUniqueViolation(error)) {
        throw new DuplicateBookingError()
      }
      throw error
    }

    await enqueueBookingCreated(tx, created.id)

    return toGuestBooking({
      booking: created,
      slot: claimed,
      service: target.service,
      organizer: target.organizer,
    })
  })
}

/**
 * Cancel a booking by its `manageToken` and release its seats (ADR-002).
 * Status flip and `bookedCount` decrement happen in one transaction — invariant
 * 1 says the counter equals the seats held by `confirmed` bookings, so a
 * cancellation that updated only one of the two would break it.
 *
 * The `status = 'confirmed'` predicate is what makes this idempotent under a
 * double-tap: the second call updates no row and is reported as already
 * cancelled instead of decrementing the counter twice.
 *
 * Returns `null` for an unknown token, so the caller answers `404` without
 * confirming whether the token exists.
 */
export async function cancelGuestBookingByToken(token: string): Promise<GuestBooking | null> {
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ booking: bookings, slot: timeSlots, service: services, organizer: organizers })
      .from(bookings)
      .innerJoin(timeSlots, eq(bookings.timeSlotId, timeSlots.id))
      .innerJoin(services, eq(timeSlots.serviceId, services.id))
      .innerJoin(organizers, eq(services.organizerId, organizers.id))
      .where(eq(bookings.manageToken, token))
      .limit(1)

    if (!target) return null

    assertNotDemo(target.organizer.id)

    const [cancelled] = await tx
      .update(bookings)
      .set({ status: 'cancelled' })
      .where(and(eq(bookings.id, target.booking.id), eq(bookings.status, 'confirmed')))
      .returning()

    if (!cancelled) {
      throw new BookingAlreadyCancelledError()
    }

    const [released] = await tx
      .update(timeSlots)
      .set({
        bookedCount: sql`greatest(0, ${timeSlots.bookedCount} - ${cancelled.seats})`,
      })
      .where(eq(timeSlots.id, cancelled.timeSlotId))
      .returning()

    await enqueueBookingCancelled(tx, cancelled.id, 'guest')

    return toGuestBooking({
      booking: cancelled,
      slot: released ?? target.slot,
      service: target.service,
      organizer: target.organizer,
    })
  })
}

// ── Organizer-facing writes ──────────────────────────────────────────────────

/**
 * Cancel a booking **scoped to its owner** and release its seats.
 * The cabinet counterpart of {@link cancelGuestBookingByToken}: same state
 * transition and the same seat release, reached by a different credential. The
 * guest proves ownership with a `manageToken`; the organizer proves it by
 * owning the service the booking hangs off, so the id is scoped through
 * {@link ownedSlotIds} in the `WHERE` clause.
 *
 * Returns the organizer's DTO, not the guest's: {@link toBookingRecord} drops
 * `manageToken`, which the cabinet must never receive even as a side effect.
 */
export async function cancelOwnedBooking(
  organizerId: string,
  bookingId: string,
): Promise<BookingRecord | null> {
  assertNotDemo(organizerId)

  return db.transaction(async (tx) => {
    const [target] = await tx
      .select()
      .from(bookings)
      .where(
        and(eq(bookings.id, bookingId), inArray(bookings.timeSlotId, ownedSlotIds(organizerId))),
      )
      .limit(1)

    if (!target) return null

    const [cancelled] = await tx
      .update(bookings)
      .set({ status: 'cancelled' })
      .where(and(eq(bookings.id, target.id), eq(bookings.status, 'confirmed')))
      .returning()

    if (!cancelled) {
      throw new BookingAlreadyCancelledError()
    }

    await tx
      .update(timeSlots)
      .set({ bookedCount: sql`greatest(0, ${timeSlots.bookedCount} - ${cancelled.seats})` })
      .where(eq(timeSlots.id, cancelled.timeSlotId))

    await enqueueBookingCancelled(tx, cancelled.id, 'organizer')

    return toBookingRecord(cancelled)
  })
}
