/**
 * One-time login links — the minting half.
 *
 * A notification that deep-links an organizer into `/cabinet` has to carry its
 * own proof of identity: the cabinet needs no session, so without one the
 * organizer would land in the read-only demo (ADR-010) instead of their
 * bookings. The link is delivered into their verified Telegram chat, which is
 * what makes it as good as a login (the same argument as `manageToken` for
 * guests, ADR-002).
 *
 * Consumed by `apps/web` at `/login/link/{token}`; the key, TTL and payload
 * shape are shared through `@repo/contracts`.
 */

import { randomBytes } from 'node:crypto'
import { LOGIN_LINK_TTL_S, loginLinkKey, type LoginLinkPayload } from '@repo/contracts'
import { getRedis } from '@repo/redis'

/**
 * Entropy behind a login link.
 * The token is a bearer credential for a cabinet session, so it is sized to be
 * unguessable rather than short — nobody ever types it, they tap a button.
 */
const LOGIN_TOKEN_BYTES = 32

/**
 * Mint a single-use login link token pointing at `next`.
 * Called **per send attempt**, immediately before the message goes out: a retry
 * mints a fresh token and the abandoned one simply expires. That is cheaper
 * than tracking and cleaning up tokens, and it guarantees a delivered message
 * never carries a button that was already spent by an earlier attempt.
 */
export async function issueLoginLink(organizerId: string, next: string): Promise<string> {
  const token = randomBytes(LOGIN_TOKEN_BYTES).toString('base64url')
  const payload: LoginLinkPayload = { organizerId, next }

  await getRedis().set(loginLinkKey(token), JSON.stringify(payload), 'EX', LOGIN_LINK_TTL_S)

  return token
}
