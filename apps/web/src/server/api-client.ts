import {
  type BookingRecord,
  bookingsEnvelope,
  type CabinetSummaryEnvelope,
  cabinetSummaryEnvelope,
  type GuestBooking,
  guestBookingEnvelope,
  organizerEnvelope,
  type OrganizerProfile,
  type PublicOrganizerViewEnvelope,
  publicOrganizerViewEnvelope,
  type PublicServiceViewEnvelope,
  publicServiceViewEnvelope,
  type PublicSitemapEnvelope,
  publicSitemapEnvelope,
  serviceEnvelope,
  type ServiceRecord,
  servicesEnvelope,
  slotsEnvelope,
  type TimeSlotRecord,
} from '@repo/contracts'
import { cache } from 'react'
import type { z } from 'zod'

import { apiFetch, resolveApiOrigin } from '@/server/api'
import { internalSecretHeaders } from '@/server/internal-api'

import 'server-only'

/**
 * Server-side API client for the Python API (Phase 5.1).
 *
 * Every Next.js server read goes through here instead of `@repo/db`:
 * the Python API is the single owner of Postgres, Next.js fetches
 * over HTTP. Writes keep using `apiFetch` directly from server actions;
 * this module owns the typed read surface pages need.
 *
 * Auth mapping:
 * - public reads (`getPublic*`) send no credential.
 * - cabinet reads reuse `apiFetch`, which mints `X-Organizer-Auth` from
 *   the Auth.js session when present; anonymous callers get the demo
 *   scope server-side (ADR-010).
 * - the Auth.js provider lookup lives in `internal-api.ts` (kept
 *   separate so it never imports `apiFetch`/`auth()` — review fix 1.1).
 */

/** The shared tail of every envelope fetch: 404 → null, other
 * non-2xx → throw, body → Zod-checked payload. */
async function parseEnvelopeResponse<S extends z.ZodType>(
  res: Response,
  path: string,
  schema: S,
): Promise<z.infer<S> | null> {
  if (res.status === 404) return null
  if (!res.ok) {
    throw new Error(`API request failed: ${path} answered ${res.status}`)
  }
  const data: unknown = await res.json().catch(() => ({}))
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    throw new Error(`API contract violation: ${path} returned an unexpected shape`)
  }
  return parsed.data
}

async function fetchEnvelope<S extends z.ZodType>(
  path: string,
  schema: S,
  init: RequestInit = {},
): Promise<z.infer<S> | null> {
  // Cabinet reads are per-organizer private data minted from the
  // request's Auth.js session: never cache them in the shared Next
  // Data Cache (a cached `cabinet-services` could serve organizer A's
  // rows to B). `cache: 'no-store'` keeps the per-request fetch while
  // still allowing React dedup within the render.
  const res = await apiFetch(path, { ...init, cache: 'no-store' })
  return parseEnvelopeResponse(res, path, schema)
}

async function fetchPublicEnvelope<S extends z.ZodType>(
  path: string,
  schema: S,
  tags: string[],
  options: { revalidateSeconds?: number } & RequestInit = {},
): Promise<z.infer<S> | null> {
  const { revalidateSeconds = 60, ...init } = options
  const origin = await resolveApiOrigin()
  // Public catalog reads are unauthenticated and shared: cache them for
  // a short window so generateMetadata + page + OG image share one
  // origin fetch instead of three. Tags allow on-demand invalidation
  // when an organizer mutates public content. The internal-secret
  // header marks this as a trusted SSR call, so it counts against the
  // dedicated server-side rate-limit bucket rather than the shared
  // public egress-IP one (ADR-023 Phase 1).
  const headers = new Headers(init.headers)
  for (const [key, value] of Object.entries(internalSecretHeaders())) {
    headers.set(key, value)
  }
  const res = await fetch(`${origin}${path}`, {
    ...init,
    headers,
    next: { tags, revalidate: revalidateSeconds },
  })
  return parseEnvelopeResponse(res, path, schema)
}

/**
 * Public organizer view: profile + services + upcoming slots in one call.
 * `cache()`-memoized per request: generateMetadata + page + OG image
 * share one HTTP fetch instead of three.
 */
export const getPublicOrganizerView = cache(
  async (slug: string): Promise<PublicOrganizerViewEnvelope | null> => {
    return fetchPublicEnvelope(
      `/api/public/organizers/${encodeURIComponent(slug.toLowerCase())}`,
      publicOrganizerViewEnvelope,
      ['public-organizer', `public-organizer:${slug.toLowerCase()}`],
    )
  },
)

/** Public service view: service + parent organizer + upcoming slots. */
export const getPublicServiceView = cache(
  async (serviceId: string): Promise<PublicServiceViewEnvelope | null> => {
    return fetchPublicEnvelope(
      `/api/public/services/${encodeURIComponent(serviceId)}`,
      publicServiceViewEnvelope,
      ['public-service', `public-service:${serviceId}`],
    )
  },
)

/**
 * Sitemap catalog: every public slug + service path.
 * A 404 here is a route misconfiguration (the handler has no 404 path) —
 * throw instead of masking it as an empty catalog.
 */
export async function getPublicSitemap(): Promise<PublicSitemapEnvelope> {
  const view = await fetchPublicEnvelope('/api/public/sitemap', publicSitemapEnvelope, [
    'public-sitemap',
  ])
  if (view === null) {
    throw new Error('API request failed: /api/public/sitemap answered 404')
  }
  return view
}

/**
 * Guest booking by manageToken. POST: the token is a secret, kept out of
 * URLs. Unauthenticated but single-credential — no-store like the
 * cabinet reads (must never land in the shared cache).
 */
export async function getGuestBooking(manageToken: string): Promise<GuestBooking | null> {
  const origin = await resolveApiOrigin()
  const res = await fetch(`${origin}/api/bookings/manage-lookup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...internalSecretHeaders() },
    body: JSON.stringify({ manageToken }),
    cache: 'no-store',
  })
  // 400 = malformed/expired token: a lookup refusal, not an outage.
  if (res.status === 400) return null
  const envelope = await parseEnvelopeResponse(
    res,
    '/api/bookings/manage-lookup',
    guestBookingEnvelope,
  )
  return envelope?.booking ?? null
}

/** Organizer profile this request may view (demo for anonymous, null when unseeded). */
export async function getOrganizerProfile(): Promise<OrganizerProfile | null> {
  const envelope = await fetchEnvelope('/api/organizers/me', organizerEnvelope)
  return envelope?.organizer ?? null
}

/** Services of the organizer this request may view, oldest first. */
export async function listServices(): Promise<ServiceRecord[]> {
  const envelope = await fetchEnvelope('/api/services', servicesEnvelope)
  return envelope?.services ?? []
}

/** One service scoped to the viewer; null when unknown or foreign. */
export async function getOwnedService(serviceId: string): Promise<ServiceRecord | null> {
  const envelope = await fetchEnvelope(
    `/api/services/${encodeURIComponent(serviceId)}`,
    serviceEnvelope,
  )
  return envelope?.service ?? null
}

/** Slots across the viewer's services, earliest first. */
export async function listSlots(
  options: { upcomingOnly?: boolean } = {},
): Promise<TimeSlotRecord[]> {
  const path = options.upcomingOnly ? '/api/slots?upcoming=1' : '/api/slots'
  const envelope = await fetchEnvelope(path, slotsEnvelope)
  return envelope?.slots ?? []
}

/** Bookings of the viewer, newest first, paginated (default 50).
 * `hasMore` comes from the server — it fetched one row past the page. */
export async function listBookings(
  options: { limit?: number; offset?: number } = {},
): Promise<{ bookings: BookingRecord[]; hasMore: boolean }> {
  const limit = options.limit ?? 50
  const offset = options.offset ?? 0
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  const envelope = await fetchEnvelope(`/api/bookings?${params.toString()}`, bookingsEnvelope)
  return { bookings: envelope?.bookings ?? [], hasMore: envelope?.hasMore ?? false }
}

/**
 * Cabinet summary: per-service counts + 30-day analytics aggregates.
 * A 404 here is a route misconfiguration (the handler has no 404 path) —
 * throw instead of masking it as a zero envelope.
 */
export async function getCabinetSummary(): Promise<CabinetSummaryEnvelope> {
  const envelope = await fetchEnvelope('/api/cabinet/summary', cabinetSummaryEnvelope)
  if (envelope === null) {
    throw new Error('API request failed: /api/cabinet/summary answered 404')
  }
  return envelope
}
