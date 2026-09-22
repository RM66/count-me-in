/**
 * Server-side reads and DTO mapping for organizers.
 *
 * Profile updates moved to the Go API (`apps/web/pkg/db/organizer.go`)
 * together with the route handlers — this module now serves only the pages
 * that read Postgres directly: the cabinet, the public organizer pages and
 * the sitemap.
 *
 * Two projections, one table: {@link toOrganizerProfile} is the organizer's own
 * view, {@link toPublicOrganizer} the one guests get on `/{orgSlug}`. Keeping
 * them as separate mappers rather than deleting fields at the call site is what
 * stops the messenger identity from leaking to a public page by omission.
 */

import type { OrganizerProfile, PublicOrganizer } from '@repo/contracts'
import { DEFAULT_LOCALE, isAppLocale, isDemoOrganizerId } from '@repo/contracts'
import type { Organizer } from '@repo/db'
import { db, organizers } from '@repo/db'
import { asc, eq } from 'drizzle-orm'

import 'server-only'

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
 *
 * Not cached (consolidated review P0-2): the `unstable_cache` wrapper and its
 * `public-organizers` tag used to be here, but writes moved to the Go API
 * (ADR-013), which cannot call `revalidateTag` — the tag was never
 * invalidated, so a renamed organizer served stale pages (and stale 404s for
 * the new slug) for up to 5 minutes. Reading fresh costs one indexed query per
 * render; when read traffic justifies caching again, add a Go → Next
 * revalidation endpoint instead of a tag nothing can invalidate.
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
 * Every organizer slug, for `app/sitemap.ts`. Slugs are unique (schema index),
 * so the list maps one-to-one onto public URLs.
 */
export async function listPublicOrganizerSlugs(): Promise<Array<{ slug: string }>> {
  return db.select({ slug: organizers.slug }).from(organizers).orderBy(asc(organizers.createdAt))
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
