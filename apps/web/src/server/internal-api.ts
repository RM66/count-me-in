import { createHmac } from 'node:crypto'
import {
  internalOrganizerEnvelope,
  internalOrganizerLookupInput,
  type InternalOrganizerRecord,
} from '@repo/contracts'

import { deploymentBypassHeaders, resolveApiOrigin } from '@/server/api-origin'

import 'server-only'

/**
 * Internal service client for the Python API (ADR-022).
 *
 * Lives apart from `api-client.ts` on purpose: the provider lookup needs
 * no Auth.js session and must not import `apiFetch` (which pulls in
 * `auth()` → `telegram-provider` → back here). Depending only on
 * `resolveApiOrigin` keeps the graph acyclic:
 * `telegram-provider` → `internal-api` → `api` (origin only).
 *
 * The secret derivation mirrors `derived_internal_secret` in
 * `countmein/auth/internal.py` exactly: PRK = HMAC(salt, IKM),
 * OKM = HMAC(PRK, info || 0x01) truncated to 32 bytes, hex-encoded.
 * Parity is pinned by the golden vector in `internal-api.test.ts`.
 */

export const INTERNAL_SECRET_HEADER = 'x-internal-secret'
const INTERNAL_HKDF_SALT = 'countmein'
const INTERNAL_HKDF_INFO = 'CountMeIn Internal Service Key v1'

/**
 * Derive the internal service secret from AUTH_SECRET via HKDF-SHA256.
 * Memoized per secret — HKDF is pure key schedule, and every server fetch
 * asks for the same derivation.
 */
const derivedSecretCache = new Map<string, string>()

export function derivedInternalSecret(authSecret: string): string {
  const cached = derivedSecretCache.get(authSecret)
  if (cached) return cached
  const prk = createHmac('sha256', INTERNAL_HKDF_SALT).update(authSecret, 'utf8').digest()
  const secret = createHmac('sha256', prk)
    .update(Buffer.concat([Buffer.from(INTERNAL_HKDF_INFO, 'utf8'), Buffer.from([0x01])]))
    .digest()
    .subarray(0, 32)
    .toString('hex')
  derivedSecretCache.set(authSecret, secret)
  return secret
}

/**
 * The x-internal-secret header for trusted server-side calls, or {} when
 * AUTH_SECRET is absent. Every Next.js→Python server-to-server request
 * carries it: the API counts it against a dedicated rate-limit bucket
 * instead of the caller-IP one — serverless SSR shares Vercel egress
 * IPs, so a crawler burst would otherwise drain the shared bucket and
 * 429 every SSR fetch site-wide (ADR-023).
 */
export function internalSecretHeaders(): Record<string, string> {
  const authSecret = process.env.AUTH_SECRET
  if (!authSecret) return {}
  return { [INTERNAL_SECRET_HEADER]: derivedInternalSecret(authSecret) }
}

/** Stamp the internal-secret header onto an existing Headers object. */
export function withInternalHeaders(headers: Headers): void {
  for (const [key, value] of Object.entries(internalSecretHeaders())) {
    headers.set(key, value)
  }
}

/**
 * Internal organizer lookup for Auth.js: by messenger identity or by id.
 *
 * Returns null when not found, when the lookup shape is invalid, or when
 * AUTH_SECRET is unconfigured. A 401 means the derived secret does not
 * match the API (AUTH_SECRET drift or derivation skew) — that is a
 * server misconfiguration, not "unknown organizer", so it throws
 * instead of returning null (ADR-024).
 */
export async function getInternalOrganizer(lookup: {
  messenger?: string
  messengerId?: string
  organizerId?: string
}): Promise<InternalOrganizerRecord | null> {
  const authSecret = process.env.AUTH_SECRET
  if (!authSecret) return null
  const parsed = internalOrganizerLookupInput.safeParse(lookup)
  if (!parsed.success) return null
  const origin = await resolveApiOrigin()
  const res = await fetch(`${origin}/api/internal/auth/organizer-by-messenger`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...internalSecretHeaders(),
      ...(await deploymentBypassHeaders()),
    },
    body: JSON.stringify(parsed.data),
    // Service-to-service credential lookup: never cacheable.
    cache: 'no-store',
  })
  if (res.status === 401) {
    throw new Error('Internal service authentication failed')
  }
  if (res.status === 404 || res.status === 400) return null
  if (!res.ok) {
    throw new Error(`API request failed: internal organizer lookup answered ${res.status}`)
  }
  const data: unknown = await res.json().catch(() => ({}))
  const envelope = internalOrganizerEnvelope.safeParse(data)
  if (!envelope.success) {
    throw new Error('API contract violation: internal organizer lookup shape mismatch')
  }
  return envelope.data.organizer
}
