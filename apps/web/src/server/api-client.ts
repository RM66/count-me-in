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

import { apiFetch } from '@/server/api'
import { deploymentBypassHeaders, resolveApiOrigin } from '@/server/api-origin'
import { withInternalHeaders } from '@/server/internal-api'

import 'server-only'

/**
 * Server-side API client for the Python API (ADR-021).
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
 *   separate so it never imports `apiFetch`/`auth()` — ADR-022).
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
  // request's Auth.js session: `apiFetch` already forces no-store, so
  // they never land in the shared Next Data Cache (a cached response
  // could serve organizer A's rows to B).
  const res = await apiFetch(path, init)
  return parseEnvelopeResponse(res, path, schema)
}

async function fetchPublicEnvelope<S extends z.ZodType>(
  path: string,
  schema: S,
  tags: string[],
  init: RequestInit = {},
): Promise<z.infer<S> | null> {
  const origin = await resolveApiOrigin()
  // Public catalog reads are unauthenticated and shared: cache them for
  // a short window so generateMetadata + page + OG image share one
  // origin fetch instead of three. Tags allow on-demand invalidation
  // when an organizer mutates public content.
  const headers = new Headers(init.headers)
  withInternalHeaders(headers)
  for (const [key, value] of Object.entries(await deploymentBypassHeaders())) {
    headers.set(key, value)
  }
  const res = await fetch(`${origin}${path}`, {
    ...init,
    headers,
    next: { tags, revalidate: 60 },
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
  const headers = new Headers({ 'Content-Type': 'application/json' })
  withInternalHeaders(headers)
  for (const [key, value] of Object.entries(await deploymentBypassHeaders())) {
    headers.set(key, value)
  }
  const res = await fetch(`${origin}/api/bookings/manage-lookup`, {
    method: 'POST',
    headers,
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

/**
 * Organizer profile this request may view (demo for anonymous, null when
 * unseeded). Wrapped in `cache()`: the cabinet layout and every cabinet page
 * need it — one HTTP fetch per render pass, not one per consumer.
 */
export const getOrganizerProfile = cache(async (): Promise<OrganizerProfile | null> => {
  const envelope = await fetchEnvelope('/api/organizers/me', organizerEnvelope)
  return envelope?.organizer ?? null
})

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

type ListSlotsOptions = {
  /** Drop sessions that have already started. */
  upcomingOnly?: boolean
  /** Range bounds on `startsAt` — RFC 3339 instants (calendar-week reads). */
  from?: string
  to?: string
  /** Cap the earliest-first order — the "next N sessions" previews. */
  limit?: number
  /** Also return the full day-key set — `?include=days`, a DISTINCT scan the API only runs on request. */
  includeDays?: boolean
}

/**
 * Slots across the viewer's services, earliest first. Callers that only
 * need a window pass `from`/`to`/`limit` — the unbounded read is for the
 * schedule manager itself. `days` is the full set of session day keys,
 * independent of the range (the calendar picker's marks), and only when
 * `includeDays` asks for it.
 */
export async function listSlots(
  options: ListSlotsOptions = {},
): Promise<{ slots: TimeSlotRecord[]; days: string[] }> {
  const params = new URLSearchParams()
  if (options.upcomingOnly) params.set('upcoming', '1')
  if (options.from) params.set('from', options.from)
  if (options.to) params.set('to', options.to)
  if (options.limit) params.set('limit', String(options.limit))
  if (options.includeDays) params.set('include', 'days')
  const query = params.toString()
  const envelope = await fetchEnvelope(`/api/slots${query ? `?${query}` : ''}`, slotsEnvelope)
  return { slots: envelope?.slots ?? [], days: envelope?.days ?? [] }
}

/** Sort columns `?sort=` accepts — the bookings table's column keys. */
type BookingSort = 'guest' | 'service' | 'when' | 'seats' | 'status'

type ListBookingsOptions = {
  limit?: number
  offset?: number
  /** Only bookings whose slot belongs to this service. */
  serviceId?: string
  /** Only bookings on this session — the narrower scope. */
  slotId?: string
  status?: 'confirmed' | 'cancelled'
  /** Case-insensitive substring across guest fields and the service title. */
  q?: string
  /** `YYYY-MM-DD` in the organizer's timezone — the session's start day. */
  day?: string
  sort?: BookingSort
  dir?: 'asc' | 'desc'
  /** Also return the scoped booked-day keys — `?include=days` (picker marks). */
  includeDays?: boolean
}

/**
 * Bookings of the viewer, paginated (default 50) and filtered server-side —
 * the cabinet's URL state maps onto the query params 1:1, so a page is
 * already the filtered view. `hasMore` comes from the server (it fetched
 * one row past the page); `bookedDays` marks the scoped days for the picker;
 * `slots` carries the session rows the page references (plus the owned
 * `slotId` filter session) so row labels need no whole-schedule fetch.
 */
export async function listBookings(options: ListBookingsOptions = {}): Promise<{
  bookings: BookingRecord[]
  hasMore: boolean
  slots: TimeSlotRecord[]
  bookedDays: string[]
}> {
  const params = new URLSearchParams({
    limit: String(options.limit ?? 50),
    offset: String(options.offset ?? 0),
  })
  if (options.serviceId) params.set('serviceId', options.serviceId)
  if (options.slotId) params.set('slotId', options.slotId)
  if (options.status) params.set('status', options.status)
  if (options.q) params.set('q', options.q)
  if (options.day) params.set('day', options.day)
  if (options.sort) params.set('sort', options.sort)
  if (options.dir) params.set('dir', options.dir)
  if (options.includeDays) params.set('include', 'days')
  const envelope = await fetchEnvelope(`/api/bookings?${params.toString()}`, bookingsEnvelope)
  return {
    bookings: envelope?.bookings ?? [],
    hasMore: envelope?.hasMore ?? false,
    slots: envelope?.slots ?? [],
    bookedDays: envelope?.bookedDays ?? [],
  }
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
