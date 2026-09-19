/**
 * Server-side reads and DTO mapping for time slots.
 *
 * The write paths (create, update, delete) moved to the Go API
 * (`apps/web/pkg/db/timeslot.go`) together with the route
 * handlers — this module now serves only the pages that read Postgres
 * directly: the cabinet schedule/calendar and the public service pages.
 *
 * **Ownership is transitive.** There is no `organizerId` on `time_slots`: a slot
 * belongs to a service, and the service belongs to an organizer (invariant 5 in
 * docs/domain.md). Reads here scope through the parent service with the
 * ownedServiceIds subquery in the `WHERE` clause.
 */

import type { TimeSlotRecord } from '@repo/contracts'
import type { TimeSlot } from '@repo/db'
import { db, services, timeSlots } from '@repo/db'
import { and, asc, eq, gte, inArray } from 'drizzle-orm'

import 'server-only'

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
  const scope = inArray(
    timeSlots.serviceId,
    db.select({ id: services.id }).from(services).where(eq(services.organizerId, organizerId)),
  )

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
