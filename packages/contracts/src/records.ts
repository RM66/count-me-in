import { z } from 'zod'

import { displayName, serviceId, slugShape, uuid } from './primitives'

/**
 * Records that are not full entities: read models, projections, and
 * catalogue entries embedded inside response envelopes.
 */

export const sitemapOrganizerEntry = z.object({
  slug: slugShape,
})
export type SitemapOrganizerEntry = z.infer<typeof sitemapOrganizerEntry>

export const sitemapServiceEntry = z.object({
  orgSlug: slugShape,
  serviceId: serviceId,
})
export type SitemapServiceEntry = z.infer<typeof sitemapServiceEntry>

export const serviceCountsRecord = z.object({
  serviceId,
  upcomingSlotsCount: z.number().int(),
  confirmedBookingsCount: z.number().int(),
})
export type ServiceCountsRecord = z.infer<typeof serviceCountsRecord>

/**
 * The cabinet overview's stat cards, computed server-side — a 50-row
 * booking page could never answer these (they are all-time / all-upcoming
 * aggregates, not page projections).
 */
export const cabinetOverviewRecord = z.object({
  /** Confirmed bookings across every service, all time. */
  confirmedBookings: z.number().int(),
  /** Confirmed bookings created in the last 7 days. */
  confirmedLast7Days: z.number().int(),
  /** Sessions that have not started yet. */
  upcomingSlots: z.number().int(),
  /** Upcoming sessions starting within the next 7 days. */
  upcomingSlotsNext7Days: z.number().int(),
  /** Seats reserved on upcoming sessions (sum of bookedCount). */
  upcomingSeatsBooked: z.number().int(),
  /** Seats offered on upcoming sessions (sum of capacity). */
  upcomingSeatsOffered: z.number().int(),
})
export type CabinetOverviewRecord = z.infer<typeof cabinetOverviewRecord>

export const analyticsTrendDay = z.object({
  day: z.string(),
  bookings: z.number().int(),
  seats: z.number().int(),
})
export type AnalyticsTrendDay = z.infer<typeof analyticsTrendDay>

export const analyticsServiceCount = z.object({
  service: z.string(),
  bookings: z.number().int(),
})
export type AnalyticsServiceCount = z.infer<typeof analyticsServiceCount>

export const analyticsSummaryRecord = z.object({
  totalBookings: z.number().int(),
  prevTotalBookings: z.number().int(),
  seatsSold: z.number().int(),
  prevSeatsSold: z.number().int(),
  windowBookings: z.number().int(),
  cancelledInWindow: z.number().int(),
  trend: z.array(analyticsTrendDay),
  byService: z.array(analyticsServiceCount),
})
export type AnalyticsSummaryRecord = z.infer<typeof analyticsSummaryRecord>

/** The Auth.js-facing organizer projection (internal endpoint only). */
export const internalOrganizerRecord = z.object({
  id: uuid,
  name: displayName,
  slug: slugShape,
  photoUrl: z.string().nullable(),
})
export type InternalOrganizerRecord = z.infer<typeof internalOrganizerRecord>
