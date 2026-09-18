import { z } from 'zod'

import { messengerEnum } from './enums'
import { authTicket, httpUrl, messengerId, uuid } from './primitives'

/**
 * Auth.js session cookie names, most-secure first. Auth.js itself reads only
 * the `__Secure-` name on HTTPS; both are listed because local development
 * serves plain HTTP, and the Go API accepts either.
 */
export const SESSION_COOKIE_NAMES = ['__Secure-authjs.session-token', 'authjs.session-token'] as const

/**
 * Telegram numeric user id. Bounded rather than `.positive()` so the bound is
 * derivable as a Go int range — an exclusive minimum is not (D10).
 */
export const telegramUserId = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)

/** Unix seconds; the upper bound is 2100-01-01, far past any plausible widget. */
export const telegramAuthDate = z.number().int().min(1).max(4_102_444_800)

/** Telegram caps names at 64; 256 leaves room without accepting a payload bomb. */
export const telegramName = z.string().min(1).max(256)

/** Optional name/username fields: present-but-empty is what the widget sends today. */
export const telegramOptionalName = z.string().max(256)

/** HMAC-SHA256 hex digest. */
export const telegramHash = z.string().min(64).max(64)

/**
 * Telegram Login Widget payload from the client.
 * Server re-validates the HMAC before trusting any field.
 */
export const telegramWidgetPayload = z.object({
  id: telegramUserId,
  first_name: telegramName,
  last_name: telegramOptionalName.optional(),
  username: telegramOptionalName.optional(),
  photo_url: httpUrl.optional(),
  auth_date: telegramAuthDate,
  hash: telegramHash,
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

/** Identity payload cached in Redis behind an auth ticket (ADR-008). */
export const authTicketPayload = z.object({
  messenger: messengerEnum,
  messengerId,
  displayName: z.string(),
  photoUrl: z.string().url().optional(),
  messengerLogin: z.string().optional(),
})
export type AuthTicketPayload = z.infer<typeof authTicketPayload>

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
// Minted by the notification job at send time, consumed on the login route,
// so the key format and payload shape live here where both can see them.

/**
 * How long a login link stays valid (30 days).
 * Sized against the message, not the session: a booking notification is still
 * plausible to tap days later. Every notification mints a fresh one.
 */
export const LOGIN_LINK_TTL_S = 30 * 24 * 60 * 60

/**
 * Redis key prefix for login links. Exported separately from
 * {@link loginLinkKey} because the Go API is code-generated from this file:
 * the generator interpolates the prefix into `contracts.LoginLinkKey`, so the
 * two sides cannot drift.
 */
export const LOGIN_LINK_KEY_PREFIX = 'auth:login-link:'

export function loginLinkKey(token: string): string {
  return `${LOGIN_LINK_KEY_PREFIX}${token}`
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
