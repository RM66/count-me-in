import { z } from 'zod'

import { messengerEnum } from './enums'
import { authTicket, messengerId, uuid } from './primitives'

/**
 * Telegram Login Widget payload from the client.
 * Server re-validates the HMAC before trusting any field.
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
 * Contains a short-lived auth ticket; `organizerExists` tells the client
 * whether to go to login or signup.
 */
export const authTicketResponse = z.object({
  ticket: authTicket,
  organizerExists: z.boolean(),
})
export type AuthTicketResponse = z.infer<typeof authTicketResponse>

/**
 * POST /api/auth/telegram-guest — same widget validation but issues a guest
 * ticket for the booking flow instead of an organizer session.
 */
export const guestTicketResponse = z.object({
  ticket: authTicket,
  messenger: messengerEnum,
  messengerId,
  displayName: z.string(),
})
export type GuestTicketResponse = z.infer<typeof guestTicketResponse>

// ── One-time login links ─────────────────────────────────────────────────────
//
// Organizer notifications deep-link into the cabinet, but `/cabinet` needs no
// session: without one the organizer would land in the read-only *demo* cabinet
// (ADR-010) instead of their own data. The messenger has already proved who the
// recipient is, so the link carries that proof — the same reasoning that makes
// `manageToken` sufficient for guests.
//
// Minted by `apps/worker` at send time, consumed by `apps/web`, so the key
// format and payload shape live here where both can see them.

/**
 * How long a login link stays valid (30 days).
 * Sized against the message, not the session: a booking notification is still
 * plausible to tap days later. Every notification mints a fresh one.
 */
export const LOGIN_LINK_TTL_S = 30 * 24 * 60 * 60

export function loginLinkKey(token: string): string {
  return `auth:login-link:${token}`
}

/**
 * What a login link resolves to once consumed.
 * `next` is stored with the token (not in the URL) so the redirect target
 * cannot be rewritten by whoever holds the link — always a relative cabinet
 * path built server-side, preventing open redirect.
 */
export const loginLinkPayload = z.object({
  organizerId: uuid,
  next: z.string().startsWith('/'),
})
export type LoginLinkPayload = z.infer<typeof loginLinkPayload>
