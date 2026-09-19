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
 * **No separate secret.** The signing key is derived from the existing
 * `AUTH_SECRET` via HKDF-SHA256 (RFC 5869) with a purpose-bound `info`
 * string — the same key-separation pattern Auth.js itself uses
 * internally. Deriving (rather than reusing the raw secret) keeps the
 * two protocols independent: a leak of one derived key reveals nothing
 * about the other, and rotating AUTH_SECRET rotates both at once. The
 * derivation parameters (salt, info, length) must match
 * `pkg/auth/session.go` exactly; parity is pinned by a golden vector
 * in `pkg/auth/session_test.go`.
 *
 * The token is short-lived (60s): it is minted per request by the
 * middleware, so a long TTL is unnecessary and a leaked header is useless
 * quickly.
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

// HKDF derivation parameters — must match pkg/auth/session.go exactly.
const HKDF_SALT = 'countmein'
const HKDF_INFO = 'CountMeIn Organizer API Token Key v1'
const HKDF_LENGTH_BYTES = 32

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
 * Derive the HMAC-SHA256 signing key from AUTH_SECRET via HKDF-SHA256.
 * Purpose-bound key separation: the raw secret never signs anything
 * directly, so this token format and Auth.js's session format cannot
 * interfere with each other.
 */
async function derivedSigningKey(secret: string): Promise<ArrayBuffer> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(secret), 'HKDF', false, [
    'deriveBits',
  ])
  return crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: enc.encode(HKDF_SALT),
      info: enc.encode(HKDF_INFO),
    },
    keyMaterial,
    HKDF_LENGTH_BYTES * 8,
  )
}

/**
 * Mint a short-lived organizer-auth token for the given organizer id/slug.
 * Returns the compact JWT string, or `null` when `AUTH_SECRET` is not
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
  const secret = process.env.AUTH_SECRET
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
    await derivedSigningKey(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput))
  return `${signingInput}.${base64url(sig)}`
}
