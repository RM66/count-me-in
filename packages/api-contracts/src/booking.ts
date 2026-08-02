import { z } from 'zod'

import { bookingStatusEnum, messengerEnum } from './enums'
import { selectedOptionsShape } from './options'
import { authTicket, displayName, manageToken, seats, serviceId, uuid } from './primitives'

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
