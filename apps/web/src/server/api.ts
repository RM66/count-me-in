import { headers } from 'next/headers'

import { auth } from '@/server/auth'
import { mintOrganizerAuth, ORGANIZER_AUTH_HEADER } from '@/server/auth/organizer-token'

import 'server-only'

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

/** Resolve the API origin for a server-side fetch. */
async function apiOrigin(): Promise<string> {
  if (process.env.NODE_ENV !== 'production') {
    return (process.env.API_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '')
  }
  const h = await headers()
  const host = h.get('host')
  if (host) {
    const proto = h.get('x-forwarded-proto') ?? 'https'
    return `${proto}://${host}`
  }
  return (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://countmein.group').replace(/\/$/, '')
}

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
  const origin = await apiOrigin()
  const reqHeaders = new Headers(init.headers)

  const session = await auth()
  if (session?.user?.id) {
    const token = await mintOrganizerAuth(session.user.id, session.user.slug)
    if (token) {
      reqHeaders.set(ORGANIZER_AUTH_HEADER, token)
    }
  }

  return fetch(`${origin}${path}`, { ...init, headers: reqHeaders })
}
