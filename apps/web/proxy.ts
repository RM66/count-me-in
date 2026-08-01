/**
 * Next.js middleware — `proxy.ts` is the Next 16 rename of `middleware.ts`.
 *
 * **Do not move this file.** Its location is the convention Next uses to find
 * it: the project root, next to `app/` (or inside `src/`, which this app does
 * not use). There is no config option pointing here, so relocating it — e.g.
 * tidying it into `lib/` — makes Next silently ship **no middleware**: the build
 * still succeeds, the `ƒ Proxy (Middleware)` line just disappears from the
 * output and signed-in organizers stop being redirected off the auth pages.
 * Verified 2026-08-01. See ADR-001 for the root-file convention.
 */

import { auth as proxy } from '@/lib/server/auth'

export { proxy }

/**
 * Only the auth pages need middleware: they redirect an already signed-in
 * organizer to the cabinet.
 *
 * `/cabinet/*` is deliberately absent — it is open to everyone (anonymous
 * visitors get the read-only demo, ADR-010), so running the middleware there
 * would decode the JWT on every request just to allow it. Cabinet pages read
 * the session themselves via `auth()` / `resolveCabinetOrganizerId()`, and
 * writes are guarded in the API layer.
 */
export const config = {
  matcher: ['/login', '/signup'],
}
