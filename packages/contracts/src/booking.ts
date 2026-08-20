import { z } from 'zod'

import { bookingStatusEnum, messengerEnum } from './enums'
import { appLocaleEnum, DEFAULT_LOCALE } from './i18n'
import { selectedOptionsShape } from './options'
import { publicOrganizer } from './organizer'
import { authTicket, displayName, manageToken, seats, serviceId, uuid } from './primitives'
import { serviceRecord } from './service'
import { timeSlotRecord } from './time-slot'

/**
 * Public booking request (ADR-008). Guest identity is derived from the
 * `guestTicket` server-side — never trusted from the client.
 * `selectedOptions` is shape-validated here; validate against the concrete
 * service with `buildSelectedOptionsSchema` before inserting (invariant 6).
 *
 * `guestLocale` is the language the guest's confirmation message is rendered
 * in (ADR-011): captured at booking time because the worker has no other way
 * to know what the guest read the page in. Optional — defaults to English.
 */
export const createBookingInput = z.object({
  serviceId,
  timeSlotId: uuid,
  seats,
  guestName: displayName,
  guestTicket: authTicket,
  selectedOptions: selectedOptionsShape.optional(),
  guestLocale: appLocaleEnum.optional().default(DEFAULT_LOCALE),
})
export type CreateBookingInput = z.infer<typeof createBookingInput>

/** Cancel via the messenger deep-link token. */
export const cancelBookingByTokenInput = z.object({ manageToken })
export type CancelBookingByTokenInput = z.infer<typeof cancelBookingByTokenInput>

/**
 * Look up the bookings of a messenger identity (ADR-002, entry path 2).
 * The identity is read from the ticket server-side — a raw `messengerId` in
 * the body would let anyone enumerate another guest's bookings.
 */
export const lookupBookingsInput = z.object({ guestTicket: authTicket })
export type LookupBookingsInput = z.infer<typeof lookupBookingsInput>

/** Organizer cancels a booking of their own service from the cabinet. */
export const cancelBookingByOrganizerInput = z.object({ bookingId: uuid })
export type CancelBookingByOrganizerInput = z.infer<typeof cancelBookingByOrganizerInput>

/**
 * A booking as the **organizer's cabinet** sees it. Dates are ISO strings.
 * `manageToken` is deliberately absent: it is the guest's cancellation secret
 * and the cabinet must never see or leak it.
 */
export const bookingRecord = z.object({
  id: uuid,
  timeSlotId: uuid,
  status: bookingStatusEnum,
  seats,
  guestName: displayName,
  guestMessenger: messengerEnum,
  guestMessengerId: z.string(),
  guestMessengerLogin: z.string().nullable(),
  selectedOptions: z.array(z.string()).nullable(),
  createdAt: z.string(),
})
export type BookingRecord = z.infer<typeof bookingRecord>

/**
 * A booking as the **guest** sees it — carries `manageToken` because that
 * token is the guest's own key to `/booking/{manageToken}`.
 * The slot and service travel with it since a guest has no cabinet lists to
 * join against. `organizer` supplies the timezone and name.
 */
export const guestBooking = z.object({
  id: uuid,
  status: bookingStatusEnum,
  seats,
  guestName: displayName,
  selectedOptions: z.array(z.string()).nullable(),
  createdAt: z.string(),
  manageToken,
  slot: timeSlotRecord,
  service: serviceRecord,
  organizer: publicOrganizer,
})
export type GuestBooking = z.infer<typeof guestBooking>
