import 'server-only'

/**
 * Edge-safe verification of the internal service credential
 * (`x-internal-secret`, ADR-022/023). The Node-side derivation lives in
 * `src/server/internal-api.ts` (node:crypto) — this module is the
 * WebCrypto twin the edge middleware needs: same salt, same info
 * string, same extract-expand order. Parity is pinned by the golden
 * vector in `internal-api.test.ts`.
 */

/** The HTTP header carrying the internal service secret (parity: internal-api.ts). */
export const INTERNAL_SECRET_HEADER = 'x-internal-secret'

const HKDF_SALT = 'countmein'
const HKDF_INFO = 'CountMeIn Internal Service Key v1'

async function hmacSha256(key: BufferSource, data: BufferSource): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return crypto.subtle.sign('HMAC', cryptoKey, data)
}

/** Derive the internal service secret from AUTH_SECRET (HKDF-SHA256, hex). */
export async function deriveInternalSecret(authSecret: string): Promise<string> {
  const enc = new TextEncoder()
  const prk = await hmacSha256(
    new Uint8Array(enc.encode(HKDF_SALT)),
    new Uint8Array(enc.encode(authSecret)),
  )
  const info = new Uint8Array(enc.encode(HKDF_INFO).length + 1)
  info.set(enc.encode(HKDF_INFO))
  info[info.length - 1] = 0x01
  const okm = new Uint8Array(await hmacSha256(new Uint8Array(prk), info))
  return Array.from(okm.subarray(0, 32), (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Constant-time verify of an `x-internal-secret` header value against the
 * secret derived from AUTH_SECRET. False when either side is missing —
 * an unverifiable caller is just anonymous, never a 500.
 */
export async function verifyInternalSecret(given: string | null): Promise<boolean> {
  const authSecret = process.env.AUTH_SECRET
  if (!given || !authSecret) return false
  const expected = await deriveInternalSecret(authSecret)
  if (given.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < given.length; i++) {
    diff |= given.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return diff === 0
}
