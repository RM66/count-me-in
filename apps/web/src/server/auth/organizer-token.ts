/**
 * Mints a short-lived HS256 JWT that the Go API verifies to identify the
 * signed-in organizer (architecture review fix #1).
 *
 * The Go API used to decrypt the Auth.js session cookie by hand — a
 * reverse-engineering of `@auth/core`'s internal JWE format that a minor
 * Auth.js upgrade could break silently. Instead, the Next.js edge
 * middleware (`proxy.ts`, which already runs on every request and already
 * reads Auth.js sessions) mints this **self-controlled, documented** token
 * into the `X-Organizer-Auth` header. The Go side verifies HS256 — a
 * stable format we own, not one we chase.
 *
 * The token is short-lived (60s): it is minted per request by the
 * middleware, so a long TTL is unnecessary and a leaked header is useless
 * quickly. The secret is `API_TOKEN_SECRET`, shared with the Go API.
 *
 * Server-only: the secret must never reach the browser bundle. The
 * middleware (edge runtime) imports this via `proxy.ts`; server actions
 * import it via `server/api.ts`.
 */
import 'server-only'

const HEADER = { alg: 'HS256', typ: 'JWT' }
/** Token lifetime in seconds — short, since it is minted per request. */
export const ORGANIZER_AUTH_TTL_S = 60
/** The header the Go API reads. */
export const ORGANIZER_AUTH_HEADER = 'x-organizer-auth'

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes
  let bin = ''
  for (const b of view) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlStr(input: string): string {
  return btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Mint a short-lived organizer-auth token for the given organizer id/slug.
 * Returns the compact JWT string, or `null` when `API_TOKEN_SECRET` is not
 * configured (the Go API then sees no header and treats the caller as
 * anonymous — the same outcome as a missing session).
 *
 * Async because Web Crypto (`crypto.subtle`) is async in both the edge and
 * node runtimes.
 */
export async function mintOrganizerAuth(
  organizerId: string,
  slug: string | undefined,
): Promise<string | null> {
  const secret = process.env.API_TOKEN_SECRET
  if (!secret) return null

  const now = Math.floor(Date.now() / 1000)
  const payload = {
    sub: organizerId,
    slug: slug ?? '',
    iat: now,
    exp: now + ORGANIZER_AUTH_TTL_S,
  }
  const headerEncoded = base64urlStr(JSON.stringify(HEADER))
  const payloadEncoded = base64urlStr(JSON.stringify(payload))
  const signingInput = `${headerEncoded}.${payloadEncoded}`

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput))
  return `${signingInput}.${base64url(sig)}`
}
