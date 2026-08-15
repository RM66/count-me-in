import { createServiceInput } from '@repo/contracts'
import { NextResponse } from 'next/server'

import { createService, listServices } from '@/server/db/service'
import { resolveCabinetOrganizerId } from '@/server/demo'
import { parseJsonBody, requireWritableOrganizer } from '@/server/http'
import { isOwnMediaUrl } from '@/server/storage/media'

/**
 * Services for the organizer this request may view — the signed-in organizer,
 * or the demo organizer for anonymous visitors (ADR-010), same contract as
 * `GET /api/organizers/me`.
 *
 * The cabinet list page reads Postgres directly (it is a server component), so
 * this exists for clients that need the collection over HTTP.
 */
export async function GET() {
  const { organizerId } = await resolveCabinetOrganizerId()

  return NextResponse.json({ services: await listServices(organizerId) })
}

/**
 * Create a service owned by the signed-in organizer.
 *
 * `organizerId` always comes from the session — never from the body — so an
 * organizer cannot create a service under someone else's account.
 */
export async function POST(request: Request) {
  const guard = await requireWritableOrganizer()
  if (!guard.ok) return guard.response
  const { organizerId } = guard.value

  const parsed = await parseJsonBody(request, createServiceInput)
  if (!parsed.ok) return parsed.response
  const input = parsed.value

  // A cover URL must live under this organizer's media prefix — otherwise the
  // row could point at an arbitrary host or another organizer's object.
  if (input.photoUrl !== undefined && !isOwnMediaUrl(organizerId, input.photoUrl)) {
    return NextResponse.json(
      { error: 'Invalid photoUrl: must belong to your media prefix' },
      { status: 400 },
    )
  }

  const service = await createService(organizerId, input)

  if (!service) {
    return NextResponse.json({ error: 'Could not create the service' }, { status: 500 })
  }

  return NextResponse.json({ service }, { status: 201 })
}
