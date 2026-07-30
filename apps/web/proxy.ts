import { auth as proxy } from '@/lib/services/auth'

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
