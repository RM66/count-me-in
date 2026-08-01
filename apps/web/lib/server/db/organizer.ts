/**
 * Server-side reads, writes and DTO mapping for organizers.
 *
 * Cabinet pages are server components that query Postgres directly, while the
 * route handlers return the same shape over HTTP — both go through
 * {@link toOrganizerProfile} so the client only ever sees one contract.
 */

import type { OrganizerProfile, UpdateOrganizerProfileInput } from '@repo/api-contracts'
import type { Organizer } from '@repo/db'
import { db, organizers } from '@repo/db'
import { eq } from 'drizzle-orm'

import { pickDefined } from './shared'

import 'server-only'

/**
 * Profile columns the cabinet may write. Messenger identity (`messenger`,
 * `messengerId`), `id` and `createdAt` are deliberately absent — they are set
 * at registration and never editable.
 */
const UPDATABLE_FIELDS = [
  'name',
  'slug',
  'timezone',
  'description',
  'location',
  'contact',
  'photoUrl',
] as const

/** Normalize an `organizers` row into the API/DTO shape (dates → ISO strings). */
export function toOrganizerProfile(row: Organizer, isDemo: boolean): OrganizerProfile {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    messenger: row.messenger,
    messengerId: row.messengerId,
    timezone: row.timezone,
    description: row.description,
    photoUrl: row.photoUrl,
    location: row.location,
    contact: row.contact,
    createdAt: row.createdAt.toISOString(),
    isDemo,
  }
}

/**
 * Profile for the organizer this request may view — the signed-in organizer,
 * or the demo organizer for anonymous visitors (ADR-010).
 *
 * Returns `null` when the id does not exist (e.g. the demo seed has not run).
 */
export async function getOrganizerProfile(
  organizerId: string,
  isDemo: boolean,
): Promise<OrganizerProfile | null> {
  const [row] = await db.select().from(organizers).where(eq(organizers.id, organizerId)).limit(1)

  if (!row) return null

  return toOrganizerProfile(row, isDemo)
}

/**
 * Update the current organizer's profile.
 * Editable fields: name, slug, timezone, description, location, contact, photoUrl.
 * Messenger identity is not editable.
 *
 * Returns `null` when the organizer id does not exist.
 */
export async function updateOrganizerProfile(
  organizerId: string,
  input: UpdateOrganizerProfileInput,
): Promise<OrganizerProfile | null> {
  const updates = pickDefined(input, UPDATABLE_FIELDS)

  const [updated] = await db
    .update(organizers)
    .set(updates)
    .where(eq(organizers.id, organizerId))
    .returning()

  if (!updated) return null

  // A successful write means this is not the demo account.
  return toOrganizerProfile(updated, false)
}
