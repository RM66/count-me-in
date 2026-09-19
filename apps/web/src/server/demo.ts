/**
 * Server-side demo-organizer resolution for pages (ADR-010).
 *
 * The write-side guards (rejectDemoWrite / assertNotDemo) moved to the Go
 * API (`apps/web/pkg/demo`) together with the route handlers —
 * enforcement now lives where the writes happen. What remains here is the
 * read-side question every cabinet page starts with: whose data should this
 * request render?
 *
 * **Two ways to be "demo":** an anonymous visitor (no session — `/cabinet` is
 * open to everyone and shows the demo) *or* a session that somehow carries the
 * demo id. Both are treated identically.
 */

import { DEMO_ORGANIZER_ID, isDemoOrganizerId } from '@repo/contracts'

import { auth } from './auth'

import 'server-only'

/**
 * The organizer whose data the cabinet should show for this request:
 * the signed-in organizer, or the demo organizer when there is no session.
 * Returns `isDemo` alongside the id so callers never re-derive it.
 */
export async function resolveCabinetOrganizerId(): Promise<{
  organizerId: string
  isDemo: boolean
}> {
  const session = await auth()
  const sessionId = session?.user?.id

  if (!sessionId) {
    return { organizerId: DEMO_ORGANIZER_ID, isDemo: true }
  }

  return { organizerId: sessionId, isDemo: isDemoOrganizerId(sessionId) }
}

/**
 * Whether this request should see the cabinet as read-only — true for anonymous
 * visitors (who get the demo) and for the demo id itself.
 * For **server components** that render controls as disabled. Client components
 * use the `useIsDemo()` hook, which reads the derived `isDemo` field from the
 * organizer profile.
 */
export async function isDemoSession(): Promise<boolean> {
  const { isDemo } = await resolveCabinetOrganizerId()
  return isDemo
}
