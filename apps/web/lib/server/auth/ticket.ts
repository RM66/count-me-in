import { randomBytes } from 'node:crypto'
import type { Messenger } from '@repo/api-contracts'
import { getRedis } from '@repo/redis'

import 'server-only'

/**
 * Short-lived auth ticket service (ADR-008).
 *
 * Replaces the full OTP flow: only tickets remain (no codes, no cooldowns, no attempt counters).
 * Tickets are issued after server-side HMAC validation of the Telegram Login Widget payload.
 *
 * Keys in Redis:
 *   auth:ticket:{token}  — JSON payload, 10 min TTL, single-use (consumed on session creation)
 *   auth:rate:{ip}       — per-IP issue rate limit (optional, set by callers)
 */

const TICKET_TTL_S = 10 * 60
const TICKET_BYTES = 32

/** Expected length of a base64url-encoded ticket string (43 chars). */
export const TICKET_BASE64URL_LENGTH = Math.ceil((TICKET_BYTES * 4) / 3)

export interface AuthTicketPayload {
  messenger: Messenger
  messengerId: string
  displayName: string
  photoUrl?: string
  /**
   * Human-readable messenger login the organizer can use to reach the guest.
   * Telegram: @username (may be absent if the user has no username set).
   * WhatsApp (future): phone number.
   */
  messengerLogin?: string
}

/** Issue a new short-lived auth ticket for a validated messenger identity. */
export async function issueTicket(payload: AuthTicketPayload): Promise<string> {
  const token = randomBytes(TICKET_BYTES).toString('base64url')
  await getRedis().set(`auth:ticket:${token}`, JSON.stringify(payload), 'EX', TICKET_TTL_S)
  return token
}

/** Read a ticket without consuming it (used while registration form is in flight). */
export async function peekTicket(token: string): Promise<AuthTicketPayload | null> {
  const raw = await getRedis().get(`auth:ticket:${token}`)
  return raw ? (JSON.parse(raw) as AuthTicketPayload) : null
}

/** Atomically read + delete a ticket (used when establishing a session). */
export async function consumeTicket(token: string): Promise<AuthTicketPayload | null> {
  const raw = await getRedis().getdel(`auth:ticket:${token}`)
  return raw ? (JSON.parse(raw) as AuthTicketPayload) : null
}
