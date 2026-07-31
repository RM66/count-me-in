import { createServiceInput } from '@repo/api-contracts'
import { db, services } from '@repo/db'
import { NextResponse } from 'next/server'

import { auth } from '@/lib/services/auth'
import {
  demoReadOnlyResponse,
  rejectDemoWrite,
  resolveCabinetOrganizerId,
} from '@/lib/services/demo'
import { listServices, toServiceRecord } from '@/lib/services/service'
import { isOwnMediaUrl } from '@/lib/services/storage/media'

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
  const session = await auth()
  const organizerId = session?.user?.id

  // Read-only demo (ADR-010). Also narrows `organizerId` to a string.
  const denied = rejectDemoWrite(organizerId)
  if (denied || !organizerId) return denied ?? demoReadOnlyResponse()

  const body = await request.json()
  const parsed = createServiceInput.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const input = parsed.data

  // A cover URL must live under this organizer's media prefix — otherwise the
  // row could point at an arbitrary host or another organizer's object.
  if (input.photoUrl !== undefined && !isOwnMediaUrl(organizerId, input.photoUrl)) {
    return NextResponse.json(
      { error: 'Invalid photoUrl: must belong to your media prefix' },
      { status: 400 },
    )
  }

  const [created] = await db
    .insert(services)
    .values({
      organizerId,
      title: input.title,
      description: input.description ?? null,
      photoUrl: input.photoUrl ?? null,
      location: input.location ?? null,
      contact: input.contact ?? null,
      defaultPrice: input.defaultPrice,
      defaultCapacity: input.defaultCapacity,
      defaultDurationMinutes: input.defaultDurationMinutes,
      options: input.options ?? null,
      optionsSelectMode: input.optionsSelectMode ?? null,
    })
    .returning()

  if (!created) {
    return NextResponse.json({ error: 'Could not create the service' }, { status: 500 })
  }

  return NextResponse.json({ service: toServiceRecord(created) }, { status: 201 })
}
