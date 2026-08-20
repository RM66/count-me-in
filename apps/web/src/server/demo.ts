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
 * - cabinet: profile update, avatar upload, service CRUD, service cover upload,
 *   slot CRUD, organizer-side booking cancel
 * - guest: create booking, cancel booking by `manageToken` — both go through
 *   {@link assertNotDemo} *inside* the booking transaction rather than a route
 *   guard, because they carry no session: the organizer is only known once the
 *   slot has been joined to its service.
 * - worker: skip notification jobs entirely (see `isDemoOrganizerId`)
 */

import {
  DEMO_ORGANIZER_ID,
  DEMO_READ_ONLY_CODE,
  DEMO_READ_ONLY_MESSAGE,
  isDemoOrganizerId,
} from '@repo/contracts'
import { NextResponse } from 'next/server'
import { getTranslations } from 'next-intl/server'

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

/**
 * Returns a localized `403 DEMO_READ_ONLY` response when `organizerId` is the
 * demo account or absent — anonymous callers are demo-cabinet visitors and get
 * the same refusal (ADR-010) — otherwise `null`. Intended for early-return use
 * in route handlers. Error *classes* keep English messages for logs; the copy
 * in the response body follows the viewer's locale (ADR-011).
 */
export async function rejectDemoWrite(
  organizerId: string | null | undefined,
): Promise<NextResponse | null> {
  if (organizerId && !isDemoOrganizerId(organizerId)) return null

  const t = await getTranslations('ApiErrors')
  return NextResponse.json({ error: t('demoReadOnly'), code: DEMO_READ_ONLY_CODE }, { status: 403 })
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
