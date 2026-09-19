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
 *    header so the Go API can identify the signed-in organizer **without
 *    decrypting the Auth.js session cookie** (architecture review fix #1).
 *    The Go API used to hand-roll `@auth/core`'s internal JWE format — a
 *    coupling that a minor Auth.js upgrade could break silently. This
 *    middleware already runs on every matched request and already reads
 *    Auth.js sessions, so it is the natural place to translate the
 *    session into a stable, self-controlled token.
 *
 * `/cabinet/*` is deliberately absent — it is open to everyone (anonymous
 * visitors get the read-only demo, ADR-010), so running the middleware
 * there would decode the session on every request just to allow it.
 * Cabinet pages read the session themselves via `auth()` /
 * `resolveCabinetOrganizerId()`, and writes are guarded in the API layer.
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

  // API routes: mint the organizer-auth header for the Go API.
  if (pathname.startsWith('/api/') && !pathname.startsWith('/api/auth/')) {
    const response = NextResponse.next()
    const session = await auth()
    if (session?.user?.id) {
      const token = await mintOrganizerAuth(session.user.id, session.user.slug)
      if (token) {
        response.headers.set(ORGANIZER_AUTH_HEADER, token)
      }
    }
    return response
  }

  return NextResponse.next()
}

/**
 * Match the auth pages (redirect) and the Go-owned API routes (header
 * minting). The Auth.js routes (`/api/auth/*`) stay on Next.js and need no
 * organizer-auth header — they are excluded so the middleware does not
 * run on them.
 *
 * `/cabinet/*` is deliberately absent — it is open to everyone (anonymous
 * visitors get the read-only demo, ADR-010), so running the middleware
 * there would decode the session on every request just to allow it.
 * Cabinet pages read the session themselves via `auth()` /
 * `resolveCabinetOrganizerId()`, and writes are guarded in the API layer.
 */
export const config = {
  matcher: ['/login', '/signup', '/api/((?!auth/).*)'],
}
