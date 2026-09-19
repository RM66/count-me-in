import { z } from 'zod'

import { bookingRecord, guestBooking } from './booking'
import { organizerProfile } from './organizer'
import { serviceId, uuid } from './primitives'
import { serviceRecord } from './service'
import { timeSlotRecord } from './time-slot'

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

export const invalidIssuesBody = z.object({
  error: z.string(),
  issues: z.record(z.string(), z.array(z.string())),
})
export type InvalidIssuesBody = z.infer<typeof invalidIssuesBody>
