/**
 * Demo organizer account (ADR-010).
 *
 * A single, seeded, **read-only** organizer for the "See a live example"
 * link on the landing page. Demo-ness is a code constant, not a database
 * column: the login path for the demo account is a special case that has to
 * name the organizer in code anyway (auth is messenger-only — ADR-008).
 * A mutable `is_demo` flag would be additional security-relevant state.
 *
 * Lives in `contracts` so that every layer that must recognize the demo id —
 * web writes, notification handlers — shares one source of truth.
 */

/** Fixed id of the seeded demo organizer. Stable across re-seeds. */
export const DEMO_ORGANIZER_ID = '01930000-0000-7000-8000-0000000000de'

/** Public slug of the demo organizer: `countmein.group/demo`. */
export const DEMO_ORGANIZER_SLUG = 'demo'

/**
 * Fixed service ids of the demo organizer. These appear in public URLs
 * (`/demo/{serviceId}`), so they are stable text ids shared here so the
 * seed and the UI cannot disagree.
 */
export const DEMO_SERVICE_IDS = {
  yoga: 'demo-yoga',
  pottery: 'demo-pottery',
  breathwork: 'demo-breathwork',
} as const

/** Public URL path of the demo organizer's booking page. */
export const DEMO_ORGANIZER_PATH = `/${DEMO_ORGANIZER_SLUG}`

/**
 * Path to the read-only demo **cabinet**.
 * `/cabinet` shows the demo to anyone without a session, so this is the
 * plain cabinet path. Named separately so marketing links read intelligibly.
 */
export const DEMO_CABINET_PATH = '/cabinet'

/** Machine-readable error code returned by write paths that touch demo data. */
export const DEMO_READ_ONLY_CODE = 'DEMO_READ_ONLY'

/** User-facing copy for a rejected write against the demo account. */
export const DEMO_READ_ONLY_MESSAGE =
  'This is a read-only demo account — sign up to create your own bookable services.'

/**
 * True when the given organizer id is the demo account.
 * Call this on **every** write path, including guest-facing ones.
 */
export function isDemoOrganizerId(organizerId: string | null | undefined): boolean {
  return organizerId === DEMO_ORGANIZER_ID
}

/** True when the given slug belongs to the demo account. */
export function isDemoOrganizerSlug(slug: string | null | undefined): boolean {
  return slug?.toLowerCase() === DEMO_ORGANIZER_SLUG
}
