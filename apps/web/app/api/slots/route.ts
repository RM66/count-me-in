import { createTimeSlotInput } from '@repo/api-contracts'
import { NextResponse } from 'next/server'

import { createSlot, listSlots } from '@/lib/server/db/time-slot'
import { resolveCabinetOrganizerId } from '@/lib/server/demo'
import { parseJsonBody, requireWritableOrganizer } from '@/lib/server/http'

/**
 * Slots across every service of the organizer this request may view — the
 * signed-in organizer, or the demo organizer for anonymous visitors (ADR-010),
 * same contract as `GET /api/services`.
 *
 * The cabinet list page reads Postgres directly (it is a server component), so
 * this exists for clients that need the collection over HTTP.
 *
 * `?upcoming=1` drops slots that have already started.
 */
export async function GET(request: Request) {
  const { organizerId } = await resolveCabinetOrganizerId()
  const upcomingOnly = new URL(request.url).searchParams.get('upcoming') === '1'

  return NextResponse.json({ slots: await listSlots(organizerId, { upcomingOnly }) })
}

/**
 * Create a slot under one of the signed-in organizer's services.
 *
 * Ownership comes from the session, never the body: a `serviceId` belonging to
 * someone else answers `404`, so the endpoint never confirms that a foreign
 * service exists.
 */
export async function POST(request: Request) {
  const guard = await requireWritableOrganizer()
  if (!guard.ok) return guard.response
  const { organizerId } = guard.value

  const parsed = await parseJsonBody(request, createTimeSlotInput)
  if (!parsed.ok) return parsed.response

  const slot = await createSlot(organizerId, parsed.value)

  if (!slot) {
    return NextResponse.json({ error: 'Service not found' }, { status: 404 })
  }

  return NextResponse.json({ slot }, { status: 201 })
}
