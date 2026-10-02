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
