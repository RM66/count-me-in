import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import type { Messenger } from '@repo/api-contracts'

import { getRedis } from '../redis'

/**
 * OTP lifecycle in Redis (ADR-005: codes + rate limits live in Redis, short TTL).
 *
 * Keys:
 *   otp:code:{phone}      — sha256 of the active code (+ messenger), 5 min TTL
 *   otp:attempts:{phone}  — failed verify counter, expires with the code window
 *   otp:cooldown:{phone}  — resend cooldown flag, 60 s TTL
 *   otp:sent:{phone}      — sends-per-hour counter
 *   otp:ticket:{token}    — proof of verified phone ownership, 10 min TTL
 */

const CODE_TTL_S = 5 * 60
const COOLDOWN_S = 60
const MAX_SENDS_PER_HOUR = 5
const MAX_VERIFY_ATTEMPTS = 5
const TICKET_TTL_S = 10 * 60
const TICKET_BYTES = 32

/** Expected length of a base64url-encoded ticket string. */
export const TICKET_BASE64URL_LENGTH = Math.ceil((TICKET_BYTES * 4) / 3) // 43

const hash = (code: string) => createHash('sha256').update(code).digest('hex')

export type RequestOtpResult =
  { ok: true; code: string } | { ok: false; reason: 'cooldown' | 'too_many_requests' }

/** Create (or replace) the active code for a phone, enforcing resend limits. */
export async function createOtp(phone: string, messenger: Messenger): Promise<RequestOtpResult> {
  const redis = getRedis()

  const onCooldown = await redis.set(`otp:cooldown:${phone}`, '1', 'EX', COOLDOWN_S, 'NX')
  if (onCooldown === null) {
    return { ok: false, reason: 'cooldown' }
  }

  const sent = await redis.incr(`otp:sent:${phone}`)
  if (sent === 1) {
    await redis.expire(`otp:sent:${phone}`, 60 * 60)
  }
  if (sent > MAX_SENDS_PER_HOUR) {
    return { ok: false, reason: 'too_many_requests' }
  }

  const code = randomInt(100_000, 1_000_000).toString()
  await redis.set(`otp:code:${phone}`, `${hash(code)}:${messenger}`, 'EX', CODE_TTL_S)
  await redis.del(`otp:attempts:${phone}`)

  return { ok: true, code }
}

export type VerifyOtpResult =
  | { ok: true; ticket: string; messenger: Messenger }
  | { ok: false; reason: 'expired' | 'invalid' | 'too_many_attempts' }

/** Check a code; on success burn it and issue a phone-ownership ticket. */
export async function verifyOtp(phone: string, code: string): Promise<VerifyOtpResult> {
  const redis = getRedis()

  const stored = await redis.get(`otp:code:${phone}`)
  if (!stored) {
    return { ok: false, reason: 'expired' }
  }

  const attempts = await redis.incr(`otp:attempts:${phone}`)
  if (attempts === 1) {
    await redis.expire(`otp:attempts:${phone}`, CODE_TTL_S)
  }
  if (attempts > MAX_VERIFY_ATTEMPTS) {
    await redis.del(`otp:code:${phone}`)
    return { ok: false, reason: 'too_many_attempts' }
  }

  const [storedHash, messenger] = stored.split(':') as [string, Messenger]
  const given = hash(code)
  if (
    storedHash.length !== given.length ||
    !timingSafeEqual(Buffer.from(storedHash), Buffer.from(given))
  ) {
    return { ok: false, reason: 'invalid' }
  }

  await redis.del(`otp:code:${phone}`, `otp:attempts:${phone}`)

  const ticket = randomBytes(TICKET_BYTES).toString('base64url')
  await redis.set(`otp:ticket:${ticket}`, JSON.stringify({ phone, messenger }), 'EX', TICKET_TTL_S)

  return { ok: true, ticket, messenger }
}

export interface TicketPayload {
  phone: string
  messenger: Messenger
}

/** Read a ticket without consuming it (used while registration is still in flight). */
export async function peekTicket(ticket: string): Promise<TicketPayload | null> {
  const raw = await getRedis().get(`otp:ticket:${ticket}`)
  return raw ? (JSON.parse(raw) as TicketPayload) : null
}

/** Atomically read + delete a ticket (used when establishing a session). */
export async function consumeTicket(ticket: string): Promise<TicketPayload | null> {
  const raw = await getRedis().getdel(`otp:ticket:${ticket}`)
  return raw ? (JSON.parse(raw) as TicketPayload) : null
}
