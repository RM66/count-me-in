import { headers } from 'next/headers'

import 'server-only'

/**
 * Resolve the API origin for a server-side fetch (review fix 1.1/2.3).
 *
 * Kept in its own leaf module so both `api.ts` (session-minting writes)
 * and `internal-api.ts` (Auth.js provider lookup) share one origin
 * without forming an import cycle through `auth()`.
 *
 * In production, the API lives at the same origin (Vercel rewrites route
 * routing); the incoming request's Host header supplies the origin. In
 * dev, the API server runs separately at `API_URL` (default :3001).
 * The container twin (docker compose) sets API_URL alongside
 * NODE_ENV=production, so an explicit API_URL always wins — same-origin
 * applies only when no separate API origin is configured.
 */
export async function resolveApiOrigin(): Promise<string> {
  const apiUrl = process.env.API_URL?.replace(/\/$/, '')
  if (apiUrl) {
    return apiUrl
  }
  if (process.env.NODE_ENV !== 'production') {
    return 'http://127.0.0.1:3001'
  }
  const h = await headers()
  const host = h.get('host')
  if (host) {
    const proto = h.get('x-forwarded-proto') ?? 'https'
    return `${proto}://${host}`
  }
  return (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://countmein.group').replace(/\/$/, '')
}
