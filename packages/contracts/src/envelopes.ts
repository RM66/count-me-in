import { z } from 'zod'

import { bookingRecord, guestBooking } from './booking'
import { organizerProfile, publicOrganizer } from './organizer'
import { serviceId, uuid } from './primitives'
import {
  analyticsSummaryRecord,
  internalOrganizerRecord,
  serviceCountsRecord,
  sitemapOrganizerEntry,
  sitemapServiceEntry,
} from './records'
import { serviceRecord } from './service'
import { timeSlotRecord } from './time-slot'

/**
 * Response envelopes: the named wrapper objects every endpoint returns.
 * Record shapes live in `./records`, error bodies in `./errors`.
 */

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

export const bookingsEnvelope = z.object({
  bookings: z.array(bookingRecord),
  /** Whether another page exists past `offset + bookings.length`. */
  hasMore: z.boolean(),
})
export type BookingsEnvelope = z.infer<typeof bookingsEnvelope>

export const guestBookingsEnvelope = z.object({ bookings: z.array(guestBooking) })
export type GuestBookingsEnvelope = z.infer<typeof guestBookingsEnvelope>

export const organizerEnvelope = z.object({ organizer: organizerProfile })
export type OrganizerEnvelope = z.infer<typeof organizerEnvelope>

export const deletedServiceEnvelope = z.object({ id: serviceId })
export type DeletedServiceEnvelope = z.infer<typeof deletedServiceEnvelope>

export const deletedSlotEnvelope = z.object({ id: uuid })
export type DeletedSlotEnvelope = z.infer<typeof deletedSlotEnvelope>

export const cabinetSummaryEnvelope = z.object({
  serviceCounts: z.array(serviceCountsRecord),
  analytics: analyticsSummaryRecord,
})
export type CabinetSummaryEnvelope = z.infer<typeof cabinetSummaryEnvelope>

export const internalOrganizerEnvelope = z.object({
  organizer: internalOrganizerRecord,
})
export type InternalOrganizerEnvelope = z.infer<typeof internalOrganizerEnvelope>
