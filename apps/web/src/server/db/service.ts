/**
 * Server-side reads and DTO mapping for services.
 *
 * The write paths (create, update, delete) moved to the Go API
 * (`apps/web/internal/db/service.go`) together with the route
 * handlers — this module now serves only the pages that read Postgres
 * directly: the cabinet lists, the public organizer/service pages and
 * the sitemap.
 */

import type { ServiceRecord } from '@repo/contracts'
import type { Service } from '@repo/db'
import { db, organizers, services, timeSlots } from '@repo/db'
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
    maxSeatsPerBooking: row.maxSeatsPerBooking,
    options: row.options,
    optionsSelectMode: row.optionsSelectMode,
    createdAt: row.createdAt.toISOString(),
  }
}

/**
 * All services belonging to an organizer, oldest first.
 *
 * Read fresh: writes happen in Go and cannot invalidate the Next.js cache.
 */
export async function listServices(organizerId: string): Promise<ServiceRecord[]> {
  const rows = await db
    .select()
    .from(services)
    .where(eq(services.organizerId, organizerId))
    .orderBy(asc(services.createdAt))

  return rows.map(toServiceRecord)
}

/**
 * Every service with its owner's slug, for `app/sitemap.ts` — the
 * `/{orgSlug}/{serviceId}` URL is assembled from two tables.
 */
export async function listPublicServicePaths(): Promise<
  Array<{ orgSlug: string; serviceId: string }>
> {
  return db
    .select({ orgSlug: organizers.slug, serviceId: services.id })
    .from(services)
    .innerJoin(organizers, eq(services.organizerId, organizers.id))
    .orderBy(asc(services.createdAt))
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
  const [row] = await db
    .select()
    .from(services)
    .where(and(eq(services.id, serviceId), eq(services.organizerId, organizerId)))
    .limit(1)

  return row ? toServiceRecord(row) : null
}

/**
 * A service reached through a public page, scoped to the organizer whose slug
 * is in the URL. `/{orgSlug}/{serviceId}` must `404` when the service belongs
 * to a different organizer. There is no separate public DTO: every column of
 * `serviceRecord` is already shown on the service page.
 */
export async function getPublicService(
  organizerId: string,
  serviceId: string,
): Promise<ServiceRecord | null> {
  const [row] = await db
    .select()
    .from(services)
    .where(and(eq(services.id, serviceId), eq(services.organizerId, organizerId)))
    .limit(1)

  return row ? toServiceRecord(row) : null
}

/**
 * Number of *upcoming* slots per service id, for the cabinet list.
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
