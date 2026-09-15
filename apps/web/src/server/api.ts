import { cookies, headers } from 'next/headers'

import 'server-only'

/**
 * Server-side fetch to the Go API — the write-side counterpart of the
 * browser `api-client/`. Server actions call mutating endpoints here;
 * the Go API authenticates via the Auth.js session cookie, which this
 * helper forwards so the Go side can resolve the organizer.
 *
 * In production, Go functions live at the same origin (Vercel filesystem
 * routing); the incoming request's Host header supplies the origin. In
 * dev, the Go server runs separately at `GO_API_URL` (default :3001).
 */

/** Resolve the Go API origin for a server-side fetch. */
async function goApiOrigin(): Promise<string> {
  if (process.env.NODE_ENV !== 'production') {
    return (process.env.GO_API_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '')
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
 * Fetch a Go API path with the session cookie forwarded. The caller
 * sets method, body and any non-cookie headers; this helper adds the
 * origin and the `Cookie` header for Auth.js session authentication.
 */
export async function goApiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const origin = await goApiOrigin()
  const cookieStore = await cookies()
  const sessionCookie =
    cookieStore.get('__Secure-authjs.session-token') ?? cookieStore.get('authjs.session-token')
  const reqHeaders = new Headers(init.headers)
  if (sessionCookie) {
    reqHeaders.set('Cookie', `${sessionCookie.name}=${sessionCookie.value}`)
  }
  return fetch(`${origin}${path}`, { ...init, headers: reqHeaders })
}
