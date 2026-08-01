/**
 * Server-side reads and DTO mapping for services.
 *
 * Cabinet pages are server components that query Postgres directly, while the
 * route handlers return the same shape over HTTP — both go through
 * {@link toServiceRecord} so the client only ever sees one contract.
 */

import type { ServiceRecord } from '@repo/api-contracts'
import type { Service } from '@repo/db'
import { db, services, timeSlots } from '@repo/db'
import { and, asc, count, eq, gte, inArray } from 'drizzle-orm'

import 'server-only'

/** Normalize a `services` row into the API/DTO shape (dates → ISO strings). */
export function toServiceRecord(row: Service): ServiceRecord {
  return {
    id: row.id,
    organizerId: row.organizerId,
    title: row.title,
    description: row.description,
    photoUrl: row.photoUrl,
    location: row.location,
    contact: row.contact,
    defaultPrice: row.defaultPrice,
    defaultCapacity: row.defaultCapacity,
    defaultDurationMinutes: row.defaultDurationMinutes,
    options: row.options,
    optionsSelectMode: row.optionsSelectMode,
    createdAt: row.createdAt.toISOString(),
  }
}

/** All services belonging to an organizer, oldest first. */
export async function listServices(organizerId: string): Promise<ServiceRecord[]> {
  const rows = await db
    .select()
    .from(services)
    .where(eq(services.organizerId, organizerId))
    .orderBy(asc(services.createdAt))

  return rows.map(toServiceRecord)
}

/**
 * A single service **scoped to its owner** — returns `null` when the id does
 * not exist *or* belongs to someone else, so callers cannot leak another
 * organizer's service by guessing ids.
 */
export async function getOwnedService(
  organizerId: string,
  serviceId: string,
): Promise<ServiceRecord | null> {
  const [row] = await db.select().from(services).where(eq(services.id, serviceId)).limit(1)

  if (!row || row.organizerId !== organizerId) return null

  return toServiceRecord(row)
}

/**
 * Number of *upcoming* slots per service id, for the cabinet list.
 *
 * One grouped query rather than a count per card — the list renders every
 * service, so per-row lookups would be a textbook N+1.
 */
export async function countUpcomingSlots(serviceIds: string[]): Promise<Record<string, number>> {
  if (serviceIds.length === 0) return {}

  const rows = await db
    .select({ serviceId: timeSlots.serviceId, total: count() })
    .from(timeSlots)
    .where(and(inArray(timeSlots.serviceId, serviceIds), gte(timeSlots.startsAt, new Date())))
    .groupBy(timeSlots.serviceId)

  return Object.fromEntries(rows.map((row) => [row.serviceId, Number(row.total)]))
}
