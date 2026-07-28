import { z } from 'zod'

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
