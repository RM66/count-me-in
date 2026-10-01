import { z } from 'zod'

import { bookingRecord, guestBooking } from './booking'
import { organizerProfile, publicOrganizer } from './organizer'
import { displayName, serviceId, slugShape, uuid } from './primitives'
import { serviceRecord } from './service'
import { timeSlotRecord } from './time-slot'

export const publicOrganizerViewEnvelope = z.object({
  organizer: publicOrganizer,
  services: z.array(serviceRecord),
  slots: z.array(timeSlotRecord),
})
export type PublicOrganizerViewEnvelope = z.infer<typeof publicOrganizerViewEnvelope>

export const publicServiceViewEnvelope = z.object({
  service: serviceRecord,
  organizer: publicOrganizer,
  slots: z.array(timeSlotRecord),
})
export type PublicServiceViewEnvelope = z.infer<typeof publicServiceViewEnvelope>

export const sitemapOrganizerEntry = z.object({
  slug: slugShape,
})
export type SitemapOrganizerEntry = z.infer<typeof sitemapOrganizerEntry>

export const sitemapServiceEntry = z.object({
  orgSlug: slugShape,
  serviceId: serviceId,
})
export type SitemapServiceEntry = z.infer<typeof sitemapServiceEntry>

export const publicSitemapEnvelope = z.object({
  organizers: z.array(sitemapOrganizerEntry),
  services: z.array(sitemapServiceEntry),
})
export type PublicSitemapEnvelope = z.infer<typeof publicSitemapEnvelope>

export const serviceEnvelope = z.object({ service: serviceRecord })
export type ServiceEnvelope = z.infer<typeof serviceEnvelope>

export const servicesEnvelope = z.object({ services: z.array(serviceRecord) })
export type ServicesEnvelope = z.infer<typeof servicesEnvelope>

export const slotEnvelope = z.object({ slot: timeSlotRecord })
export type SlotEnvelope = z.infer<typeof slotEnvelope>

export const slotsEnvelope = z.object({ slots: z.array(timeSlotRecord) })
export type SlotsEnvelope = z.infer<typeof slotsEnvelope>

export const guestBookingEnvelope = z.object({ booking: guestBooking })
export type GuestBookingEnvelope = z.infer<typeof guestBookingEnvelope>

export const bookingEnvelope = z.object({ booking: bookingRecord })
export type BookingEnvelope = z.infer<typeof bookingEnvelope>

export const bookingsEnvelope = z.object({ bookings: z.array(bookingRecord) })
export type BookingsEnvelope = z.infer<typeof bookingsEnvelope>

export const guestBookingsEnvelope = z.object({ bookings: z.array(guestBooking) })
export type GuestBookingsEnvelope = z.infer<typeof guestBookingsEnvelope>

export const organizerEnvelope = z.object({ organizer: organizerProfile })
export type OrganizerEnvelope = z.infer<typeof organizerEnvelope>

export const deletedServiceEnvelope = z.object({ id: serviceId })
export type DeletedServiceEnvelope = z.infer<typeof deletedServiceEnvelope>

export const deletedSlotEnvelope = z.object({ id: uuid })
export type DeletedSlotEnvelope = z.infer<typeof deletedSlotEnvelope>

export const errorBody = z.looseObject({
  error: z.string(),
  code: z.string().optional(),
  seatsLeft: z.number().int().optional(),
  maxSeats: z.number().int().optional(),
})
export type ErrorBody = z.infer<typeof errorBody>

export const validationErrors = z.object({
  formErrors: z.array(z.string()),
  fieldErrors: z.record(z.string(), z.array(z.string())),
})
export type ValidationErrors = z.infer<typeof validationErrors>

export const invalidBody = z.object({ error: z.string(), details: validationErrors })
export type InvalidBody = z.infer<typeof invalidBody>

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

export const cabinetSummaryEnvelope = z.object({
  serviceCounts: z.array(serviceCountsRecord),
  analytics: analyticsSummaryRecord,
})
export type CabinetSummaryEnvelope = z.infer<typeof cabinetSummaryEnvelope>

export const internalOrganizerRecord = z.object({
  id: uuid,
  name: displayName,
  slug: slugShape,
  photoUrl: z.string().nullable().optional(),
})
export type InternalOrganizerRecord = z.infer<typeof internalOrganizerRecord>

export const internalOrganizerEnvelope = z.object({
  organizer: internalOrganizerRecord,
})
export type InternalOrganizerEnvelope = z.infer<typeof internalOrganizerEnvelope>
