import { updateOrganizerProfileInput } from '@repo/api-contracts'
import { NextResponse } from 'next/server'

import { getOrganizerProfile, updateOrganizerProfile } from '@/lib/server/db/organizer'
import { resolveCabinetOrganizerId } from '@/lib/server/demo'
import { parseJsonBody, requireWritableOrganizer } from '@/lib/server/http'
import { isOwnMediaUrl } from '@/lib/server/storage/media'

/**
 * Profile powering the cabinet.
 *
 * Normally this is the signed-in organizer (`session.user.id` IS the organizer
 * id). **When there is no session it returns the demo organizer** with
 * `isDemo: true`, because `/cabinet` is open to anonymous visitors and renders
 * the read-only demo (ADR-010) — so this endpoint is "the organizer this
 * request may view", not strictly "me".
 *
 * Writes are never inferred from this response: `PUT` below re-checks the
 * session independently.
 */
export async function GET() {
  const { organizerId, isDemo } = await resolveCabinetOrganizerId()

  const organizer = await getOrganizerProfile(organizerId, isDemo)

  if (!organizer) {
    // For the demo id this means the seed has not been run.
    return NextResponse.json(
      { error: isDemo ? 'Demo organizer is not seeded' : 'Organizer not found' },
      { status: 404 },
    )
  }

  return NextResponse.json({ organizer })
}

/**
 * Update the current organizer's profile.
 * Editable fields: name, slug, timezone, description, location, contact, photoUrl.
 * Messenger identity is not editable.
 */
export async function PUT(request: Request) {
  const guard = await requireWritableOrganizer()
  if (!guard.ok) return guard.response
  const { organizerId } = guard.value

  const parsed = await parseJsonBody(request, updateOrganizerProfileInput)
  if (!parsed.ok) return parsed.response
  const input = parsed.value

  // A new avatar must live under this organizer's media prefix — otherwise the
  // row could point at an arbitrary host or another organizer's object.
  if (input.photoUrl != null && !isOwnMediaUrl(organizerId, input.photoUrl)) {
    return NextResponse.json(
      { error: 'Invalid photoUrl: must belong to your media prefix' },
      { status: 400 },
    )
  }

  const organizer = await updateOrganizerProfile(organizerId, input)

  if (!organizer) {
    return NextResponse.json({ error: 'Organizer not found' }, { status: 404 })
  }

  return NextResponse.json({ organizer })
}
