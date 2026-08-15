import { updateServiceInput } from '@repo/contracts'
import { NextResponse } from 'next/server'

import {
  deleteOwnedService,
  getOwnedService,
  NoServiceUpdatesError,
  updateOwnedService,
} from '@/server/db/service'
import { resolveCabinetOrganizerId } from '@/server/demo'
import { parseJsonBody, requireWritableOrganizer } from '@/server/http'
import { isOwnMediaUrl } from '@/server/storage/media'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * A single service.
 *
 * Scoped to the signed-in organizer: an id belonging to someone else answers
 * `404`, not `403`, so the endpoint never confirms that a foreign id exists.
 */
export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params
  const { organizerId } = await resolveCabinetOrganizerId()

  const service = await getOwnedService(organizerId, id)
  if (!service) {
    return NextResponse.json({ error: 'Service not found' }, { status: 404 })
  }

  return NextResponse.json({ service })
}

/**
 * Update a service owned by the signed-in organizer.
 *
 * Nullable fields follow the profile endpoint's convention: a key that is absent
 * is left untouched, an explicit `null` clears the column.
 */
export async function PUT(request: Request, { params }: RouteContext) {
  const { id } = await params

  const guard = await requireWritableOrganizer()
  if (!guard.ok) return guard.response
  const { organizerId } = guard.value

  const parsed = await parseJsonBody(request, updateServiceInput)
  if (!parsed.ok) return parsed.response
  const input = parsed.value

  if (input.photoUrl != null && !isOwnMediaUrl(organizerId, input.photoUrl)) {
    return NextResponse.json(
      { error: 'Invalid photoUrl: must belong to your media prefix' },
      { status: 400 },
    )
  }

  try {
    const service = await updateOwnedService(organizerId, id, input)

    if (!service) {
      return NextResponse.json({ error: 'Service not found' }, { status: 404 })
    }

    return NextResponse.json({ service })
  } catch (error) {
    if (error instanceof NoServiceUpdatesError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    throw error
  }
}

/**
 * Delete a service owned by the signed-in organizer.
 *
 * Slots and their bookings cascade (see the `services` FK), so this also
 * removes any scheduled sessions.
 */
export async function DELETE(_request: Request, { params }: RouteContext) {
  const { id } = await params

  const guard = await requireWritableOrganizer()
  if (!guard.ok) return guard.response
  const { organizerId } = guard.value

  const deletedId = await deleteOwnedService(organizerId, id)

  if (!deletedId) {
    return NextResponse.json({ error: 'Service not found' }, { status: 404 })
  }

  return NextResponse.json({ id: deletedId })
}
