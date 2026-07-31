/**
 * Server-side read-only enforcement for the demo organizer (ADR-010).
 *
 * Disabled inputs in the cabinet are UX, not enforcement — anyone can call the
 * API directly. Every write path must go through a guard here.
 *
 * **Two ways to be "demo":** an anonymous visitor (no session — `/cabinet` is
 * open to everyone and shows the demo) *or* a session that somehow carries the
 * demo id. Both must be treated identically, so guards accept the resolved
 * organizer id and callers use {@link resolveCabinetOrganizerId} to get it.
 *
 * Coverage checklist (keep in sync as endpoints land):
 * - cabinet: profile update ✓, avatar upload ✓, service create/update/delete ✓,
 *   service cover upload ✓, slot create/update/delete, organizer-side booking
 *   cancel
 * - guest: create booking, cancel booking by `manageToken` — these mutate
 *   `bookedCount` on a demo slot and would let anyone vandalise the public
 *   example page
 * - worker: skip notification jobs entirely (see `isDemoOrganizerId`)
 */

import {
  DEMO_ORGANIZER_ID,
  DEMO_READ_ONLY_CODE,
  DEMO_READ_ONLY_MESSAGE,
  isDemoOrganizerId,
} from '@repo/api-contracts'
import { NextResponse } from 'next/server'

import { auth } from './auth'

/**
 * The organizer whose data the cabinet should show for this request:
 * the signed-in organizer, or the demo organizer when there is no session.
 *
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
 *
 * For **server components** that render controls as disabled. Client components
 * use the `useIsDemo()` hook, which reads the derived `isDemo` field from the
 * organizer profile.
 */
export async function isDemoSession(): Promise<boolean> {
  const { isDemo } = await resolveCabinetOrganizerId()
  return isDemo
}

/** JSON body returned to clients when a demo write is rejected. */
export const demoReadOnlyBody = {
  error: DEMO_READ_ONLY_MESSAGE,
  code: DEMO_READ_ONLY_CODE,
} as const

/**
 * `403` response for a rejected demo write. `403` (not `401`) — the caller is
 * correctly authenticated, the action itself is forbidden.
 */
export function demoReadOnlyResponse(): NextResponse {
  return NextResponse.json(demoReadOnlyBody, { status: 403 })
}

/**
 * Returns a ready-to-return `403` when `organizerId` is the demo account,
 * otherwise `null`. Intended for early-return use in route handlers:
 *
 * ```ts
 * const organizerId = (await auth())?.user?.id
 * const denied = rejectDemoWrite(organizerId)
 * if (denied || !organizerId) return denied ?? demoReadOnlyResponse()
 * ```
 */
export function rejectDemoWrite(organizerId: string | null | undefined): NextResponse | null {
  // `null`/`undefined` = anonymous. Anonymous callers are browsing the demo, so
  // they get the same friendly `DEMO_READ_ONLY` refusal rather than a bare 401.
  return !organizerId || isDemoOrganizerId(organizerId) ? demoReadOnlyResponse() : null
}

/**
 * Throwing variant for use inside service-layer functions and transactions,
 * where returning a response object is not possible.
 */
export class DemoReadOnlyError extends Error {
  readonly code = DEMO_READ_ONLY_CODE
  readonly status = 403

  constructor() {
    super(DEMO_READ_ONLY_MESSAGE)
    this.name = 'DemoReadOnlyError'
  }
}

/**
 * Throws {@link DemoReadOnlyError} when `organizerId` is the demo account or
 * absent (anonymous — i.e. a demo cabinet visitor).
 */
export function assertNotDemo(organizerId: string | null | undefined): void {
  if (!organizerId || isDemoOrganizerId(organizerId)) {
    throw new DemoReadOnlyError()
  }
}
