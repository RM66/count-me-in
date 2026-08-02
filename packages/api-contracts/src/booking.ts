import { z } from 'zod'

import { bookingStatusEnum, messengerEnum } from './enums'
import { selectedOptionsShape } from './options'
import { publicOrganizer } from './organizer'
import { authTicket, displayName, manageToken, seats, serviceId, uuid } from './primitives'
import { serviceRecord } from './service'
import { timeSlotRecord } from './time-slot'

/**
 * Public booking request (ADR-008). Guest identity is derived from the `guestTicket`
 * server-side — never trusted from the client. `selectedOptions` here is only
 * shape-validated; validate it against the concrete service with
 * `buildSelectedOptionsSchema` before inserting (invariant 6).
 */
export const createBookingInput = z.object({
  serviceId,
  timeSlotId: uuid,
  seats,
  guestName: displayName,
  /** Short-lived ticket from POST /api/auth/telegram-guest (replaces guestPhone). */
  guestTicket: authTicket,
  selectedOptions: selectedOptionsShape.optional(),
})
export type CreateBookingInput = z.infer<typeof createBookingInput>

/** Cancel via the messenger deep-link token. */
export const cancelBookingByTokenInput = z.object({ manageToken })
export type CancelBookingByTokenInput = z.infer<typeof cancelBookingByTokenInput>

/**
 * Look up the bookings of a messenger identity (ADR-002, entry path 2).
 *
 * The guest re-authenticates with the login widget and the identity is read
 * from the ticket server-side — a raw `messengerId` in the body would let
 * anyone enumerate another guest's bookings.
 */
export const lookupBookingsInput = z.object({ guestTicket: authTicket })
export type LookupBookingsInput = z.infer<typeof lookupBookingsInput>

/** Organizer cancels a booking of their own service from the cabinet. */
export const cancelBookingByOrganizerInput = z.object({ bookingId: uuid })
export type CancelBookingByOrganizerInput = z.infer<typeof cancelBookingByOrganizerInput>

/**
 * A booking as the **organizer's cabinet** sees it. Mirrors the `bookings`
 * table with dates normalized to ISO strings so it can cross the server/client
 * boundary.
 *
 * `manageToken` is deliberately absent: it is the guest's cancellation secret
 * (the messenger deep-link), and the cabinet must never see or leak it. A
 * booking reaches its service transitively (Booking → TimeSlot → Service, see
 * docs/domain.md) — there is no `serviceId` here by design.
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
 * A booking as the **guest** sees it — their own reservation, so unlike
 * {@link bookingRecord} it *does* carry `manageToken`: that token is the guest's
 * own key to `/booking/{manageToken}`, and the whole point of returning it is
 * that the confirmation screen and the lookup list can link there.
 *
 * The slot and service travel with it because a booking is meaningless without
 * them (Booking → TimeSlot → Service, docs/domain.md) and the guest has no
 * cabinet lists to join against. `organizer` supplies the timezone every instant
 * is rendered in, plus the name to link back to.
 */
export const guestBooking = z.object({
  id: uuid,
  status: bookingStatusEnum,
  seats,
  guestName: displayName,
  selectedOptions: z.array(z.string()).nullable(),
  createdAt: z.string(),
  /** The guest's key to the management page. Never sent to the organizer. */
  manageToken,
  slot: timeSlotRecord,
  service: serviceRecord,
  organizer: publicOrganizer,
})
export type GuestBooking = z.infer<typeof guestBooking>
