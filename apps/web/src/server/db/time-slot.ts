/**
 * Server-side reads, writes and DTO mapping for time slots.
 *
 * Cabinet pages are server components that query Postgres directly, while the
 * route handlers return the same shape over HTTP — both go through
 * {@link toTimeSlotRecord} so the client only ever sees one contract.
 *
 * **Ownership is transitive.** There is no `organizerId` on `time_slots`: a slot
 * belongs to a service, and the service belongs to an organizer (invariant 5 in
 * docs/domain.md). Every statement here therefore scopes through the parent
 * service with {@link ownedServiceIds} in the `WHERE` clause, rather than
 * checking ownership with a preceding `SELECT` — a foreign id matches no row,
 * and there is no read-then-write gap to exploit.
 */

import type { CreateTimeSlotInput, TimeSlotRecord, UpdateTimeSlotInput } from '@repo/contracts'
import type { TimeSlot } from '@repo/db'
import { db, services, timeSlots } from '@repo/db'
import { and, asc, eq, gte, inArray } from 'drizzle-orm'

import { pickDefined } from './shared'

import 'server-only'

/** Slot columns the cabinet may write. `bookedCount` is never among them. */
const UPDATABLE_FIELDS = ['startsAt', 'durationMinutes', 'capacity', 'price'] as const

/**
 * Subquery of the service ids an organizer owns.
 * Used as `serviceId IN (…)` so ownership is enforced by the same statement
 * that reads or writes, in one round trip.
 */
function ownedServiceIds(organizerId: string) {
  return db.select({ id: services.id }).from(services).where(eq(services.organizerId, organizerId))
}

/** Normalize a `time_slots` row into the API/DTO shape (dates → ISO strings). */
export function toTimeSlotRecord(row: TimeSlot): TimeSlotRecord {
  return {
    id: row.id,
    serviceId: row.serviceId,
    startsAt: row.startsAt.toISOString(),
    durationMinutes: row.durationMinutes,
    capacity: row.capacity,
    bookedCount: row.bookedCount,
    price: row.price,
    createdAt: row.createdAt.toISOString(),
  }
}

/**
 * Every slot across an organizer's services, earliest first.
 * `upcomingOnly` drops slots that have already started — the cabinet list is a
 * schedule, so past sessions are noise there.
 */
export async function listSlots(
  organizerId: string,
  options: { upcomingOnly?: boolean } = {},
): Promise<TimeSlotRecord[]> {
  const scope = inArray(timeSlots.serviceId, ownedServiceIds(organizerId))

  const rows = await db
    .select()
    .from(timeSlots)
    .where(options.upcomingOnly ? and(scope, gte(timeSlots.startsAt, new Date())) : scope)
    .orderBy(asc(timeSlots.startsAt))

  return rows.map(toTimeSlotRecord)
}

/**
 * Upcoming slots for the given services, earliest first.
 * The **public** read: scoped by service id rather than by organizer, because
 * the guest pages have already resolved the organizer from the slug. One
 * function serves both surfaces — the service page passes a single id, the
 * organizer page passes every service so each card can show its next open
 * session without a query per card. Past slots are dropped unconditionally.
 */
export async function listUpcomingSlotsForServices(
  serviceIds: string[],
): Promise<TimeSlotRecord[]> {
  if (serviceIds.length === 0) return []

  const rows = await db
    .select()
    .from(timeSlots)
    .where(and(inArray(timeSlots.serviceId, serviceIds), gte(timeSlots.startsAt, new Date())))
    .orderBy(asc(timeSlots.startsAt))

  return rows.map(toTimeSlotRecord)
}

/**
 * A single slot **scoped to its owner** — returns `null` when the id does not
 * exist *or* hangs off another organizer's service, so callers cannot leak a
 * foreign slot by guessing ids.
 */
export async function getOwnedSlot(
  organizerId: string,
  slotId: string,
): Promise<TimeSlotRecord | null> {
  const [row] = await db
    .select()
    .from(timeSlots)
    .where(
      and(eq(timeSlots.id, slotId), inArray(timeSlots.serviceId, ownedServiceIds(organizerId))),
    )
    .limit(1)

  return row ? toTimeSlotRecord(row) : null
}

/** Raised when an update payload contains no writable field. */
export class NoSlotUpdatesError extends Error {
  constructor() {
    super('No fields to update')
    this.name = 'NoSlotUpdatesError'
  }
}

/**
 * Raised when capacity would drop below the seats already taken.
 * A CHECK constraint (`bookedCount <= capacity`) would also catch this, but as
 * an opaque `23514` that surfaces to the organizer as a `500`. Failing here
 * turns it into a `409` that says how many seats are already booked.
 */
export class SlotCapacityBelowBookedError extends Error {
  constructor(readonly bookedCount: number) {
    super(`Capacity cannot be lower than the ${bookedCount} seats already booked`)
    this.name = 'SlotCapacityBelowBookedError'
  }
}

/**
 * Create a slot under a service **owned by `organizerId`**.
 * Returns `null` when the parent service does not exist or belongs to someone
 * else, so the caller answers `404` without ever confirming a foreign id.
 *
 * Ownership is confirmed by a `SELECT` before the insert rather than folded
 * into it: `time_slots.id` is generated by a JS-side default, which an
 * `INSERT … SELECT` would skip. The gap that opens is harmless — if the service
 * disappears in between, the foreign key rejects the row.
 */
export async function createSlot(
  organizerId: string,
  input: CreateTimeSlotInput,
): Promise<TimeSlotRecord | null> {
  const [owned] = await db
    .select({ id: services.id })
    .from(services)
    .where(and(eq(services.id, input.serviceId), eq(services.organizerId, organizerId)))
    .limit(1)

  if (!owned) return null

  const [created] = await db
    .insert(timeSlots)
    .values({
      serviceId: owned.id,
      startsAt: input.startsAt,
      durationMinutes: input.durationMinutes,
      capacity: input.capacity,
      price: input.price ?? null,
    })
    .returning()

  return created ? toTimeSlotRecord(created) : null
}

/**
 * Update a slot **scoped to its owner**.
 * Returns `null` when the id does not exist or belongs to someone else — the
 * caller answers `404` either way. Throws {@link NoSlotUpdatesError} when the
 * payload carries no writable field, and {@link SlotCapacityBelowBookedError}
 * when shrinking capacity below the seats already sold.
 *
 * `bookedCount` is deliberately not updatable: seats move only through the
 * atomic reserve in the booking flow (invariant 2 in docs/domain.md).
 */
export async function updateOwnedSlot(
  organizerId: string,
  slotId: string,
  input: UpdateTimeSlotInput,
): Promise<TimeSlotRecord | null> {
  const updates = pickDefined(input, UPDATABLE_FIELDS)

  if (Object.keys(updates).length === 0) {
    throw new NoSlotUpdatesError()
  }

  const scope = and(
    eq(timeSlots.id, slotId),
    inArray(timeSlots.serviceId, ownedServiceIds(organizerId)),
  )

  return db.transaction(async (tx) => {
    if (updates.capacity !== undefined) {
      const [current] = await tx
        .select({ bookedCount: timeSlots.bookedCount })
        .from(timeSlots)
        .where(scope)
        .limit(1)

      if (!current) return null

      if (updates.capacity < current.bookedCount) {
        throw new SlotCapacityBelowBookedError(current.bookedCount)
      }
    }

    const [updated] = await tx.update(timeSlots).set(updates).where(scope).returning()

    return updated ? toTimeSlotRecord(updated) : null
  })
}

/**
 * Delete a slot **scoped to its owner**, returning its id.
 * Bookings cascade (see the `time_slots` FK). Returns `null` when nothing
 * matched. Guests are not notified from here — cancelling a slot with live
 * bookings is a notification concern for the worker.
 */
export async function deleteOwnedSlot(organizerId: string, slotId: string): Promise<string | null> {
  const [deleted] = await db
    .delete(timeSlots)
    .where(
      and(eq(timeSlots.id, slotId), inArray(timeSlots.serviceId, ownedServiceIds(organizerId))),
    )
    .returning({ id: timeSlots.id })

  return deleted?.id ?? null
}
