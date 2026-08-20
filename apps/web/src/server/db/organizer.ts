/**
 * Server-side reads, writes and DTO mapping for organizers.
 *
 * Cabinet pages are server components that query Postgres directly, while the
 * route handlers return the same shape over HTTP — both go through
 * {@link toOrganizerProfile} so the client only ever sees one contract.
 *
 * Two projections, one table: {@link toOrganizerProfile} is the organizer's own
 * view, {@link toPublicOrganizer} the one guests get on `/{orgSlug}`. Keeping
 * them as separate mappers rather than deleting fields at the call site is what
 * stops the messenger identity from leaking to a public page by omission.
 */

import type {
  AppLocale,
  OrganizerProfile,
  PublicOrganizer,
  UpdateOrganizerProfileInput,
} from '@repo/contracts'
import { DEFAULT_LOCALE, isAppLocale, isDemoOrganizerId } from '@repo/contracts'
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
    language: isAppLocale(row.language) ? row.language : DEFAULT_LOCALE,
    createdAt: row.createdAt.toISOString(),
    isDemo,
  }
}

/**
 * Normalize an `organizers` row into the **public** DTO for `/{orgSlug}`.
 * `isDemo` is derived here rather than passed in: unlike the cabinet, a public
 * page has no session to resolve it from — the slug alone decides which row is
 * being shown.
 */
export function toPublicOrganizer(row: Organizer): PublicOrganizer {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    timezone: row.timezone,
    description: row.description,
    photoUrl: row.photoUrl,
    location: row.location,
    contact: row.contact,
    isDemo: isDemoOrganizerId(row.id),
  }
}

/**
 * The organizer behind a public slug, or `null` when no such page exists — the
 * caller answers `404`. Slugs are stored lowercase (the `slug` primitive
 * transforms them), so the lookup lowercases too.
 */
export async function getPublicOrganizerBySlug(slug: string): Promise<PublicOrganizer | null> {
  const [row] = await db
    .select()
    .from(organizers)
    .where(eq(organizers.slug, slug.toLowerCase()))
    .limit(1)

  return row ? toPublicOrganizer(row) : null
}

/**
 * Profile for the organizer this request may view — the signed-in organizer,
 * or the demo organizer for anonymous visitors (ADR-010).
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
 * Messenger identity is not editable. Returns `null` when the id does not exist.
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

  return toOrganizerProfile(updated, false)
}

/**
 * Set the organizer's notification language (ADR-011). Called by the language
 * switcher's server action — the switcher is the single language setting, so
 * switching while signed in keeps `organizers.language` in sync with the UI
 * locale. Silent no-op for an unknown id (e.g. a stale session).
 */
export async function updateOrganizerLanguage(
  organizerId: string,
  language: AppLocale,
): Promise<void> {
  await db.update(organizers).set({ language }).where(eq(organizers.id, organizerId))
}
