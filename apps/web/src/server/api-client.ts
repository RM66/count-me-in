import { createHmac } from 'node:crypto'
import {
  type AnalyticsSummaryRecord,
  type BookingRecord,
  bookingsEnvelope,
  type CabinetSummaryEnvelope,
  cabinetSummaryEnvelope,
  type GuestBooking,
  guestBookingEnvelope,
  internalOrganizerEnvelope,
  internalOrganizerLookupInput,
  type InternalOrganizerRecord,
  organizerEnvelope,
  type OrganizerProfile,
  type PublicOrganizerViewEnvelope,
  publicOrganizerViewEnvelope,
  type PublicServiceViewEnvelope,
  publicServiceViewEnvelope,
  type PublicSitemapEnvelope,
  publicSitemapEnvelope,
  type ServiceCountsRecord,
  serviceEnvelope,
  type ServiceRecord,
  servicesEnvelope,
  slotEnvelope,
  slotsEnvelope,
  type TimeSlotRecord,
} from '@repo/contracts'
import { headers } from 'next/headers'
import type { z } from 'zod'

import { apiFetch } from '@/server/api'

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
 * - `getInternalOrganizer` sends `x-internal-secret` derived from
 *   `AUTH_SECRET` via HKDF-SHA256, mirroring
 *   `countmein/auth/internal.py` exactly.
 */

async function publicOrigin(): Promise<string> {
  if (process.env.NODE_ENV !== 'production') {
    return (process.env.API_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '')
  }
  const h = await headers()
  const host = h.get('host')
  if (host) {
    const proto = h.get('x-forwarded-proto') ?? 'https'
    return `${proto}://${host}`
  }
  return (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://countmein.group').replace(/\/$/, '')
}

async function fetchEnvelope<S extends z.ZodType>(
  path: string,
  schema: S,
  init: RequestInit = {},
): Promise<z.infer<S> | null> {
  const res = await apiFetch(path, init)
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

async function fetchPublicEnvelope<S extends z.ZodType>(
  path: string,
  schema: S,
  tags: string[],
  init: RequestInit = {},
): Promise<z.infer<S> | null> {
  const origin = await publicOrigin()
  const res = await fetch(`${origin}${path}`, { ...init, next: { tags } })
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

/** Public organizer view: profile + services + upcoming slots in one call. */
export async function getPublicOrganizerView(
  slug: string,
): Promise<PublicOrganizerViewEnvelope | null> {
  return fetchPublicEnvelope(
    `/api/public/organizers/${encodeURIComponent(slug.toLowerCase())}`,
    publicOrganizerViewEnvelope,
    ['public-organizer', `public-organizer:${slug.toLowerCase()}`],
  )
}

/** Public service view: service + parent organizer + upcoming slots. */
export async function getPublicServiceView(
  serviceId: string,
): Promise<PublicServiceViewEnvelope | null> {
  return fetchPublicEnvelope(
    `/api/public/services/${encodeURIComponent(serviceId)}`,
    publicServiceViewEnvelope,
    ['public-service', `public-service:${serviceId}`],
  )
}

/** Sitemap catalog: every public slug + service path. */
export async function getPublicSitemap(): Promise<PublicSitemapEnvelope> {
  const view = await fetchPublicEnvelope('/api/public/sitemap', publicSitemapEnvelope, [
    'public-sitemap',
  ])
  return view ?? { organizers: [], services: [] }
}

/** Guest booking by manageToken. POST: the token is a secret, kept out of URLs. */
export async function getGuestBooking(manageToken: string): Promise<GuestBooking | null> {
  const origin = await publicOrigin()
  const res = await fetch(`${origin}/api/bookings/manage-lookup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ manageToken }),
  })
  if (res.status === 404 || res.status === 400) return null
  if (!res.ok) {
    throw new Error(`API request failed: /api/bookings/manage-lookup answered ${res.status}`)
  }
  const data: unknown = await res.json().catch(() => ({}))
  const parsed = guestBookingEnvelope.safeParse(data)
  if (!parsed.success) {
    throw new Error('API contract violation: /api/bookings/manage-lookup shape mismatch')
  }
  return parsed.data.booking
}

/** Organizer profile this request may view (demo for anonymous, null when unseeded). */
export async function getOrganizerProfile(): Promise<OrganizerProfile | null> {
  const envelope = await fetchEnvelope('/api/organizers/me', organizerEnvelope, {
    next: { tags: ['cabinet-profile'] },
  })
  return envelope?.organizer ?? null
}

/** Services of the organizer this request may view, oldest first. */
export async function listServices(): Promise<ServiceRecord[]> {
  const envelope = await fetchEnvelope('/api/services', servicesEnvelope, {
    next: { tags: ['cabinet-services'] },
  })
  return envelope?.services ?? []
}

/** One service scoped to the viewer; null when unknown or foreign. */
export async function getOwnedService(serviceId: string): Promise<ServiceRecord | null> {
  const envelope = await fetchEnvelope(
    `/api/services/${encodeURIComponent(serviceId)}`,
    serviceEnvelope,
    { next: { tags: ['cabinet-services', `cabinet-service:${serviceId}`] } },
  )
  return envelope?.service ?? null
}

/** Slots across the viewer's services, earliest first. */
export async function listSlots(options: { upcomingOnly?: boolean } = {}): Promise<TimeSlotRecord[]> {
  const path = options.upcomingOnly ? '/api/slots?upcoming=1' : '/api/slots'
  const envelope = await fetchEnvelope(path, slotsEnvelope, {
    next: { tags: ['cabinet-slots'] },
  })
  return envelope?.slots ?? []
}

/** One slot scoped to the viewer; null when unknown or foreign. */
export async function getOwnedSlot(slotId: string): Promise<TimeSlotRecord | null> {
  const envelope = await fetchEnvelope(
    `/api/slots/${encodeURIComponent(slotId)}`,
    slotEnvelope,
    { next: { tags: ['cabinet-slots', `cabinet-slot:${slotId}`] } },
  )
  return envelope?.slot ?? null
}

/** Bookings of the viewer, newest first, paginated (default 50). */
export async function listBookings(
  options: { limit?: number; offset?: number } = {},
): Promise<BookingRecord[]> {
  const limit = options.limit ?? 50
  const offset = options.offset ?? 0
  const envelope = await fetchEnvelope(
    `/api/bookings?limit=${limit}&offset=${offset}`,
    bookingsEnvelope,
  )
  return envelope?.bookings ?? []
}

/** Cabinet summary: per-service counts + 30-day analytics aggregates. */
export async function getCabinetSummary(): Promise<CabinetSummaryEnvelope> {
  const envelope = await fetchEnvelope('/api/cabinet/summary', cabinetSummaryEnvelope, {
    next: { tags: ['cabinet-summary'] },
  })
  return (
    envelope ?? {
      serviceCounts: [],
      analytics: {
        totalBookings: 0,
        prevTotalBookings: 0,
        seatsSold: 0,
        prevSeatsSold: 0,
        windowBookings: 0,
        cancelledInWindow: 0,
        trend: [],
        byService: [],
      },
    }
  )
}

/** One point on the per-day trend chart. */
export interface AnalyticsTrendPoint {
  /** Weekday label, e.g. "Mon". */
  day: string
  /** Confirmed bookings created that day. */
  bookings: number
  /** Seats from confirmed bookings created that day. */
  seats: number
}

/** One bar on the per-service breakdown chart. */
export interface AnalyticsServicePoint {
  /** Service title. */
  service: string
  /** Confirmed bookings in the window. */
  bookings: number
}

/**
 * Zero-fill a 14-day API trend (YYYY-MM-DD keys) into the 7-day chart
 * buckets the analytics page plots, with weekday labels.
 */
export function toChartTrend(
  trend: Array<{ day: string; bookings: number; seats: number }>,
  nowMs: number = Date.now(),
): AnalyticsTrendPoint[] {
  const byDay = new Map(trend.map((row) => [row.day, row]))
  const DAY_MS = 24 * 60 * 60 * 1000
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(nowMs - (6 - i) * DAY_MS)
    const key = date.toISOString().slice(0, 10)
    const row = byDay.get(key)
    return {
      day: date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
      bookings: row?.bookings ?? 0,
      seats: row?.seats ?? 0,
    }
  })
}

/** Per-service counts keyed by service id, for the services list. */
export function serviceCountsById(
  serviceCounts: ServiceCountsRecord[],
): Record<string, { upcomingSlots: number; confirmedBookings: number }> {
  return Object.fromEntries(
    serviceCounts.map((row) => [
      row.serviceId,
      { upcomingSlots: row.upcomingSlotsCount, confirmedBookings: row.confirmedBookingsCount },
    ]),
  )
}

export type { AnalyticsSummaryRecord, ServiceCountsRecord }

const INTERNAL_SECRET_HEADER = 'x-internal-secret'
const INTERNAL_HKDF_SALT = 'countmein'
const INTERNAL_HKDF_INFO = 'CountMeIn Internal Service Key v1'

/**
 * Derive the internal service secret from AUTH_SECRET via HKDF-SHA256 —
 * the same extract-then-expand construction as
 * `derived_internal_secret` in `countmein/auth/internal.py`:
 * PRK = HMAC(salt, IKM), OKM = HMAC(PRK, info || 0x01) truncated to
 * 32 bytes, hex-encoded.
 */
export function derivedInternalSecret(authSecret: string): string {
  const prk = createHmac('sha256', INTERNAL_HKDF_SALT).update(authSecret, 'utf8').digest()
  return createHmac('sha256', prk)
    .update(Buffer.concat([Buffer.from(INTERNAL_HKDF_INFO, 'utf8'), Buffer.from([0x01])]))
    .digest()
    .subarray(0, 32)
    .toString('hex')
}

/**
 * Internal organizer lookup for Auth.js: by messenger identity or by id.
 * Returns null when not found, or when AUTH_SECRET is unconfigured.
 */
export async function getInternalOrganizer(
  lookup: { messenger?: string; messengerId?: string; organizerId?: string },
): Promise<InternalOrganizerRecord | null> {
  const authSecret = process.env.AUTH_SECRET
  if (!authSecret) return null
  const parsed = internalOrganizerLookupInput.safeParse(lookup)
  if (!parsed.success) return null
  const origin = await publicOrigin()
  const res = await fetch(`${origin}/api/internal/auth/organizer-by-messenger`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [INTERNAL_SECRET_HEADER]: derivedInternalSecret(authSecret),
    },
    body: JSON.stringify(parsed.data),
  })
  if (res.status === 404 || res.status === 400 || res.status === 401) return null
  if (!res.ok) {
    throw new Error(`API request failed: internal organizer lookup answered ${res.status}`)
  }
  const data: unknown = await res.json().catch(() => ({}))
  const envelope = internalOrganizerEnvelope.safeParse(data)
  if (!envelope.success) {
    throw new Error('API contract violation: internal organizer lookup shape mismatch')
  }
  return envelope.data.organizer
}
