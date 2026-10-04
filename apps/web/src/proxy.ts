/**
 * Next.js middleware — `proxy.ts` is the Next 16 rename of `middleware.ts`.
 *
 * **Do not move this file.** Its location is the convention Next uses to find
 * it: inside `src/`, next to `app/`. There is no config option pointing here,
 * so relocating it — e.g. tidying it into `lib/` — makes Next silently ship
 * **no middleware**: the build still succeeds, the `ƒ Proxy (Middleware)` line
 * just disappears from the output and signed-in organizers stop being
 * redirected off the auth pages. Verified 2026-08-01. See ADR-001 for the
 * root-file convention.
 */

import { type NextRequest, NextResponse } from 'next/server'

import { auth } from '@/server/auth'
import { mintOrganizerAuth, ORGANIZER_AUTH_HEADER } from '@/server/auth/organizer-token'

/**
 * Middleware entry point.
 *
 * Two responsibilities:
 *
 * 1. **Auth pages** (`/login`, `/signup`): redirect an already signed-in
 *    organizer to the cabinet. This is the original purpose of this
 *    middleware.
 *
 * 2. **API routes** (`/api/*`, except the Auth.js routes that stay on
 *    Next.js): mint a short-lived HS256 JWT into the `X-Organizer-Auth`
 *    header so the Python API can identify the signed-in organizer **without
 *    decrypting the Auth.js session cookie**. The Python API used to
 *    hand-roll `@auth/core`'s internal JWE format — a coupling that a
 *    minor Auth.js upgrade could break silently. This middleware already
 *    runs on every matched request and already reads Auth.js sessions,
 *    so it is the natural place to translate the session into a stable,
 *    self-controlled token.
 *
 *    In the container twin (standalone `next start` behind
 *    `docker compose`, `API_URL` set, no Vercel Edge Router) the API does
 *    not live at this origin — the request is rewritten to `API_URL`
 *    (browser TanStack Query calls hit `:3000/api/*` and would 404
 *    otherwise, since Next.js owns no such routes). On Vercel
 *    (`VERCEL=1`, no `API_URL`) the Edge Router serves the API from the
 *    same origin per `vercel.json`, so the request passes through.
 *
 * `/cabinet/*` is deliberately absent — it is open to everyone (anonymous
 * visitors get the read-only demo, ADR-010), so running the middleware
 * there would decode the session on every request just to allow it.
 * Cabinet reads are scoped by the API itself via the organizer-auth
 * header (anonymous callers get demo scope, `profile.isDemo` is the
 * read-only signal), and writes are guarded in the API layer.
 */
export async function proxy(request: NextRequest): Promise<NextResponse | void> {
  const { pathname } = request.nextUrl

  // Auth pages: redirect signed-in organizers to the cabinet.
  if (pathname === '/login' || pathname === '/signup') {
    const session = await auth()
    if (session?.user) {
      return NextResponse.redirect(new URL('/cabinet', request.url))
    }
    return NextResponse.next()
  }

  // API routes: mint the organizer-auth header for the Python API.
  // The token must travel in the *request* headers — the API handler
  // reads the ORGANIZER_AUTH_HEADER request header. Setting it on the
  // response (as this code once did) never reaches the handler, and
  // every browser-side organizer write arrived anonymous (403
  // DEMO_READ_ONLY).
  //
  // `/api/auth/telegram-*` are Python endpoints despite the prefix — they
  // exchange widget payloads for tickets and must be rewritten to API_URL
  // in the container twin like every other API route. Only the Auth.js
  // subtree (`/api/auth/*` minus `telegram-*`) stays on Next.js.
  const isAuthjsRoute =
    pathname.startsWith('/api/auth/') && !pathname.startsWith('/api/auth/telegram-')
  if (pathname.startsWith('/api/') && !isAuthjsRoute) {
    const requestHeaders = new Headers(request.headers)
    // The organizer-auth header is a middleware-minted credential and
    // nothing else: strip any client-supplied value before minting, so
    // an anonymous request can never carry a forged header through to
    // the Python API. The trust boundary is the topology (this edge always
    // overwrites the header), not only the signing secret.
    requestHeaders.delete(ORGANIZER_AUTH_HEADER)
    const session = await auth()
    if (session?.user?.id) {
      const token = await mintOrganizerAuth(session.user.id, session.user.slug)
      if (token) {
        requestHeaders.set(ORGANIZER_AUTH_HEADER, token)
      }
    }
    // Container twin: no Vercel Edge Router serves the API at
    // this origin, so rewrite browser /api/* calls to the separate API
    // origin. The minted header travels with the rewritten request.
    const apiOrigin = process.env.API_URL?.replace(/\/$/, '')
    if (apiOrigin && process.env.VERCEL !== '1') {
      const target = new URL(`${apiOrigin}${pathname}${request.nextUrl.search}`)
      return NextResponse.rewrite(target, { request: { headers: requestHeaders } })
    }
    return NextResponse.next({ request: { headers: requestHeaders } })
  }

  return NextResponse.next()
}

/**
 * Match the auth pages (redirect) and the API-owned routes (header
 * minting + container rewrite). Two /api subtrees stay on Next.js and are
 * excluded:
 *
 * - `/api/auth/*` — the Auth.js routes need no organizer-auth header.
 *   Exception: `/api/auth/telegram-*` are Python endpoints (widget →
 *   ticket) and *must* match, or the container twin would leave them on
 *   Next.js where Auth.js answers "unknown action".
 * - `/api/internal/revalidate` — the Python→Next.js cache-invalidation
 *   route. The middleware would rewrite it to API_URL in the container
 *   twin (a Python 404 loop) and mint an organizer header it must not
 *   carry; it authenticates by x-internal-secret.
 *
 * `/cabinet/*` is deliberately absent — it is open to everyone (anonymous
 * visitors get the read-only demo, ADR-010), so running the middleware
 * there would decode the session on every request just to allow it.
 * Cabinet reads are scoped by the API itself via the organizer-auth
 * header (anonymous callers get demo scope), and writes are guarded in
 * the API layer.
 */
export const config = {
  matcher: [
    '/login',
    '/signup',
    '/api/((?!auth/(?!telegram-(?:guest|signup))|internal/revalidate).*)',
  ],
}
