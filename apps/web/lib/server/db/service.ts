/**
 * Server-side reads, writes and DTO mapping for services.
 *
 * Cabinet pages are server components that query Postgres directly, while the
 * route handlers return the same shape over HTTP — both go through
 * {@link toServiceRecord} so the client only ever sees one contract.
 *
 * Every write is **owner-scoped**: `organizerId` sits in the `WHERE` clause
 * rather than being checked by a preceding `SELECT`, so a foreign id matches no
 * row and there is no read-then-write gap to exploit.
 */

import type { CreateServiceInput, ServiceRecord, UpdateServiceInput } from '@repo/api-contracts'
import type { Service } from '@repo/db'
import { db, services, timeSlots } from '@repo/db'
import { and, asc, count, eq, gte, inArray } from 'drizzle-orm'

import { pickDefined } from './shared'

import 'server-only'

/** Service columns the cabinet may write. `organizerId` is never among them. */
const UPDATABLE_FIELDS = [
  'title',
  'description',
  'location',
  'contact',
  'defaultPrice',
  'defaultCapacity',
  'defaultDurationMinutes',
  'options',
  'optionsSelectMode',
  'photoUrl',
] as const

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

/**
 * Create a service owned by `organizerId`.
 *
 * The owner always comes from the caller's session — never from the payload —
 * so a service cannot be created under someone else's account.
 *
 * Optional columns are normalized to `null`: the DTO and the database agree
 * that "absent" is `null`, and leaving `undefined` here would make Drizzle fall
 * back to column defaults instead.
 */
export async function createService(
  organizerId: string,
  input: CreateServiceInput,
): Promise<ServiceRecord | null> {
  const [created] = await db
    .insert(services)
    .values({
      organizerId,
      title: input.title,
      description: input.description ?? null,
      photoUrl: input.photoUrl ?? null,
      location: input.location ?? null,
      contact: input.contact ?? null,
      defaultPrice: input.defaultPrice,
      defaultCapacity: input.defaultCapacity,
      defaultDurationMinutes: input.defaultDurationMinutes,
      options: input.options ?? null,
      optionsSelectMode: input.optionsSelectMode ?? null,
    })
    .returning()

  return created ? toServiceRecord(created) : null
}

/** Raised when an update payload contains no writable field. */
export class NoServiceUpdatesError extends Error {
  constructor() {
    super('No fields to update')
    this.name = 'NoServiceUpdatesError'
  }
}

/**
 * Update a service **scoped to its owner**.
 *
 * Returns `null` when the id does not exist or belongs to someone else — the
 * caller answers `404` either way, so the endpoint never confirms that a
 * foreign id exists. Throws {@link NoServiceUpdatesError} when the payload
 * carries no writable field, which is a client mistake rather than a miss.
 */
export async function updateOwnedService(
  organizerId: string,
  serviceId: string,
  input: UpdateServiceInput,
): Promise<ServiceRecord | null> {
  const updates = pickDefined(input, UPDATABLE_FIELDS)

  if (Object.keys(updates).length === 0) {
    throw new NoServiceUpdatesError()
  }

  const [updated] = await db
    .update(services)
    .set(updates)
    .where(and(eq(services.id, serviceId), eq(services.organizerId, organizerId)))
    .returning()

  return updated ? toServiceRecord(updated) : null
}

/**
 * Delete a service **scoped to its owner**, returning its id.
 *
 * Slots and their bookings cascade (see the `services` FK), so this also
 * removes any scheduled sessions. Returns `null` when nothing matched.
 */
export async function deleteOwnedService(
  organizerId: string,
  serviceId: string,
): Promise<string | null> {
  const [deleted] = await db
    .delete(services)
    .where(and(eq(services.id, serviceId), eq(services.organizerId, organizerId)))
    .returning({ id: services.id })

  return deleted?.id ?? null
}
