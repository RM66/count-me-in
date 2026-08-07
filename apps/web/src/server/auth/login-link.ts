/**
 * One-time login links — the consuming half.
 *
 * Organizer notifications deep-link into the cabinet, but `/cabinet` needs no
 * session: without one the organizer lands in the read-only *demo* cabinet
 * (ADR-010) rather than their own bookings. The messenger has already proved
 * who the recipient is, so the link carries that proof — the same argument that
 * makes `manageToken` sufficient for guests (ADR-002).
 *
 * Tokens are **minted by `apps/worker`** at send time; this module only reads
 * them. The key format, TTL and payload schema are shared through
 * `@repo/api-contracts` so the two apps cannot drift apart.
 *
 * Same idiom as `ticket.ts`: a peek that leaves the token alone and a
 * single-use consume. The split matters here — the landing page must be able to
 * look at a token without spending it, because link previewers and scanners
 * fetch URLs before any human does.
 */

import { loginLinkKey, type LoginLinkPayload, loginLinkPayload } from '@repo/api-contracts'
import { getRedis } from '@repo/redis'

import 'server-only'

function parse(raw: string | null): LoginLinkPayload | null {
  if (!raw) return null

  try {
    const result = loginLinkPayload.safeParse(JSON.parse(raw))
    return result.success ? result.data : null
  } catch {
    return null
  }
}

/**
 * Read a login link **without** consuming it.
 * Used by the landing page to decide what to render. Consuming on `GET` would
 * hand the single use to Telegram's link preview crawler instead of the
 * organizer.
 */
export async function peekLoginLink(token: string): Promise<LoginLinkPayload | null> {
  return parse(await getRedis().get(loginLinkKey(token)))
}

/**
 * Atomically read **and delete** a login link.
 * `getdel` is what makes the link single-use: two concurrent submissions race
 * on one Redis command and only the winner receives a payload, so a replayed
 * POST cannot mint a second session.
 */
export async function consumeLoginLink(token: string): Promise<LoginLinkPayload | null> {
  return parse(await getRedis().getdel(loginLinkKey(token)))
}
