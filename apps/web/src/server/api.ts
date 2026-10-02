import { resolveApiOrigin } from '@/server/api-origin'
import { auth } from '@/server/auth'
import { mintOrganizerAuth, ORGANIZER_AUTH_HEADER } from '@/server/auth/organizer-token'
import { internalSecretHeaders } from '@/server/internal-api'

import 'server-only'

export { resolveApiOrigin }

/**
 * Server-side fetch to the Python API — the write-side counterpart of the
 * browser `api-client/`. Server actions call mutating endpoints here;
 * the API authenticates via the organizer-auth header (architecture
 * review fix #1), which this helper mints from the Auth.js session and
 * forwards so the API can resolve the organizer.
 *
 * Browser-direct calls (the `api-client/` hooks) go through `proxy.ts`,
 * which mints the same header in the edge middleware. Server actions
 * bypass the middleware (they run after it, in the same request), so they
 * mint the header here.
 *
 * In production, the API lives at the same origin (Vercel rewrites route
 * routing); the incoming request's Host header supplies the origin. In
 * dev, the API server runs separately at `API_URL` (default :3001).
 */

/**
 * Fetch an API path with the organizer-auth header forwarded. The caller
 * sets method, body and any non-cookie headers; this helper adds the
 * origin and the `X-Organizer-Auth` header for organizer authentication.
 *
 * The Auth.js session cookie is not forwarded to the API — the
 * API does not decrypt it (architecture review fix #1). The
 * organizer-auth JWT is the credential now.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const origin = await resolveApiOrigin()
  const reqHeaders = new Headers(init.headers)

  // Server-to-server calls carry the internal secret so they count
  // against the dedicated SSR rate-limit bucket, not the caller-IP one
  // (ADR-023 Phase 1). Server actions share Vercel egress IPs with SSR
  // fetches, so the distinction is "trusted caller", not "which edge".
  for (const [key, value] of Object.entries(internalSecretHeaders())) {
    reqHeaders.set(key, value)
  }

  const session = await auth()
  if (session?.user?.id) {
    const token = await mintOrganizerAuth(session.user.id, session.user.slug)
    if (token) {
      reqHeaders.set(ORGANIZER_AUTH_HEADER, token)
    }
  }

  // Same no-store rule as the cabinet reads in api-client.ts: the
  // request carries a per-organizer credential, so its response is
  // private to this request and must not land in the shared cache.
  return fetch(`${origin}${path}`, { ...init, cache: 'no-store', headers: reqHeaders })
}
