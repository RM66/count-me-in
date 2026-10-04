/**
 * Mints a short-lived HS256 JWT that the Python API verifies to identify the
 * signed-in organizer (ADR-021).
 *
 * The Python API used to decrypt the Auth.js session cookie by hand — a
 * reverse-engineering of `@auth/core`'s internal JWE format that a minor
 * Auth.js upgrade could break silently. Instead, the Next.js edge
 * middleware (`proxy.ts`, which already runs on every request and already
 * reads Auth.js sessions) mints this **self-controlled, documented** token
 * into the `X-Organizer-Auth` header. The API verifies HS256 — a
 * stable format we own, not one we chase.
 *
 * **No separate secret.** The signing key is derived from the existing
 * `AUTH_SECRET` via HKDF-SHA256 (RFC 5869) with a purpose-bound `info`
 * string — the same key-separation pattern Auth.js itself uses
 * internally. Deriving (rather than reusing the raw secret) keeps the
 * two protocols independent: a leak of one derived key reveals nothing
 * about the other, and rotating AUTH_SECRET rotates both at once. The
 * derivation parameters (salt, info, length) must match the API's
 * session verifier exactly; parity is pinned by a golden vector in
 * `tests_py/auth/test_session.py`.
 *
 * The token is short-lived (60s): it is minted per request by the
 * middleware, so a long TTL is unnecessary and a leaked header is useless
 * quickly.
 *
 * Server-only: the secret must never reach the browser bundle. The
 * middleware (edge runtime) imports this via `proxy.ts`; server actions
 * import it via `server/api.ts`.
 */
import { ORGANIZER_AUTH_AUD, ORGANIZER_AUTH_ISS } from '@repo/contracts'

import 'server-only'

const HEADER = { alg: 'HS256', typ: 'JWT' }
/** Token lifetime in seconds — short, since it is minted per request. */
export const ORGANIZER_AUTH_TTL_S = 60
/** The header the API reads. */
export const ORGANIZER_AUTH_HEADER = 'x-organizer-auth'

// HKDF derivation parameters — must match the API's session verifier
// (countmein/auth/session.py) exactly.
const HKDF_SALT = 'countmein'
const HKDF_INFO = 'CountMeIn Organizer API Token Key v1'
const HKDF_LENGTH_BYTES = 32

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes
  let bin = ''
  for (const b of view) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * base64url a UTF-8 string. `btoa(str)` throws on any code point past
 * Latin-1, so strings go through `TextEncoder` — a non-ASCII slug or a
 * future claim must not take the mint down.
 */
function base64urlStr(input: string): string {
  return base64url(new TextEncoder().encode(input))
}

/**
 * Derive the HMAC-SHA256 signing key from AUTH_SECRET via HKDF-SHA256.
 * Purpose-bound key separation: the raw secret never signs anything
 * directly, so this token format and Auth.js's session format cannot
 * interfere with each other.
 *
 * The derivation is memoized per secret: a cabinet page mints the header
 * for several parallel reads, and HKDF is pure key schedule — same input,
 * same output — so one derivation per process per secret is enough.
 */
const signingKeyCache = new Map<string, Promise<ArrayBuffer>>()

function derivedSigningKey(secret: string): Promise<ArrayBuffer> {
  const cached = signingKeyCache.get(secret)
  if (cached) return cached
  const enc = new TextEncoder()
  const derived = crypto.subtle
    .importKey('raw', enc.encode(secret), 'HKDF', false, ['deriveBits'])
    .then((keyMaterial) =>
      crypto.subtle.deriveBits(
        {
          name: 'HKDF',
          hash: 'SHA-256',
          salt: enc.encode(HKDF_SALT),
          info: enc.encode(HKDF_INFO),
        },
        keyMaterial,
        HKDF_LENGTH_BYTES * 8,
      ),
    )
  signingKeyCache.set(secret, derived)
  // A rejected derivation must not poison the cache — the next mint retries.
  derived.catch(() => signingKeyCache.delete(secret))
  return derived
}

/**
 * Mint a short-lived organizer-auth token for the given organizer id/slug.
 * Returns the compact JWT string, or `null` when `AUTH_SECRET` is not
 * configured (the Python API then sees no header and treats the caller as
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
    iss: ORGANIZER_AUTH_ISS,
    aud: ORGANIZER_AUTH_AUD,
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
