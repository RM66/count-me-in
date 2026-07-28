import { z } from 'zod'

import { messengerEnum } from './enums'
import { authTicket, messengerId } from './primitives'

/**
 * Telegram Login Widget payload received from the client after widget auth.
 * The server re-validates the HMAC before trusting any field.
 */
export const telegramWidgetPayload = z.object({
  id: z.number().int().positive(),
  first_name: z.string().min(1),
  last_name: z.string().optional(),
  username: z.string().optional(),
  photo_url: z.string().url().optional(),
  auth_date: z.number().int().positive(),
  hash: z.string().length(64),
})
export type TelegramWidgetPayload = z.infer<typeof telegramWidgetPayload>

/**
 * Response from POST /api/auth/telegram-signup.
 * Contains a short-lived auth ticket that the signup form exchanges for a session.
 * `organizerExists` tells the client whether to go to login or signup.
 */
export const authTicketResponse = z.object({
  ticket: authTicket,
  /** Whether an organizer already exists for this messenger identity. */
  organizerExists: z.boolean(),
})
export type AuthTicketResponse = z.infer<typeof authTicketResponse>

/**
 * POST /api/auth/telegram-guest — same widget validation but issues a guest ticket
 * for the booking flow instead of an organizer session.
 */
export const guestTicketResponse = z.object({
  ticket: authTicket,
  messenger: messengerEnum,
  messengerId,
  displayName: z.string(),
})
export type GuestTicketResponse = z.infer<typeof guestTicketResponse>
