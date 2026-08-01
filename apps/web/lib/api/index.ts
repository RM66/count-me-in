/**
 * Client-side API layer — the browser half of the HTTP boundary.
 *
 * `app/api/*` serves the endpoints; this calls them. One file per entity, each
 * holding that entity's queries *and* mutations so a write and the cache it
 * invalidates stay side by side (keys come from `./keys`).
 *
 * Consumers import from `@/lib/api`, never from the entity files directly.
 */

export * from './auth'
export * from './error'
export * from './keys'
export * from './organizer'
export * from './service'
export * from './time-slot'
