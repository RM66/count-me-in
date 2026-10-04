import { authTicketKey, type AuthTicketPayload, authTicketPayload } from '@repo/contracts'

import { getRedis } from '@/server/redis'

import 'server-only'

/**
 * Short-lived auth ticket service (ADR-008).
 *
 * Tickets are issued by the Python API (`/api/auth/telegram-*`) after
 * server-side HMAC validation of the Telegram Login Widget payload; this
 * module only *redeems* them when Auth.js establishes the session.
 *
 * Key in Redis: `auth:ticket:{token}` — JSON payload, 10 min TTL, single-use
 * (consumed on session creation). The prefix, TTL and payload schema are
 * shared with the API through `@repo/contracts` so the two readers/writers
 * cannot drift.
 */

const TICKET_BYTES = 32

/** Expected length of a base64url-encoded ticket string (43 chars). */
export const TICKET_BASE64URL_LENGTH = Math.ceil((TICKET_BYTES * 4) / 3)

/**
 * Atomically read + delete a ticket (used when establishing a session).
 * The payload is validated, not cast — a malformed or schema-mismatched
 * value is an unknown ticket, not a type confusion.
 */
export async function consumeTicket(token: string): Promise<AuthTicketPayload | null> {
  const raw = await getRedis().getdel(authTicketKey(token))
  if (!raw) return null
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  const parsed = authTicketPayload.safeParse(json)
  return parsed.success ? parsed.data : null
}
