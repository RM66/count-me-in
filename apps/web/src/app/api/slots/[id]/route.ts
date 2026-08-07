import { updateTimeSlotInput } from '@repo/api-contracts'
import { NextResponse } from 'next/server'

import {
  deleteOwnedSlot,
  getOwnedSlot,
  NoSlotUpdatesError,
  SlotCapacityBelowBookedError,
  updateOwnedSlot,
} from '@/server/db/time-slot'
import { resolveCabinetOrganizerId } from '@/server/demo'
import { parseJsonBody, requireWritableOrganizer } from '@/server/http'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * A single slot.
 *
 * Scoped to the signed-in organizer through its parent service: a slot owned by
 * someone else answers `404`, not `403`, so the endpoint never confirms that a
 * foreign id exists.
 */
export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params
  const { organizerId } = await resolveCabinetOrganizerId()

  const slot = await getOwnedSlot(organizerId, id)
  if (!slot) {
    return NextResponse.json({ error: 'Slot not found' }, { status: 404 })
  }

  return NextResponse.json({ slot })
}

/**
 * Update a slot owned by the signed-in organizer.
 *
 * A slot cannot be moved to another service, and `bookedCount` is not writable
 * here — seats change only through the booking flow's atomic reserve. Shrinking
 * `capacity` below the seats already sold answers `409`.
 */
export async function PUT(request: Request, { params }: RouteContext) {
  const { id } = await params

  const guard = await requireWritableOrganizer()
  if (!guard.ok) return guard.response
  const { organizerId } = guard.value

  const parsed = await parseJsonBody(request, updateTimeSlotInput)
  if (!parsed.ok) return parsed.response

  try {
    const slot = await updateOwnedSlot(organizerId, id, parsed.value)

    if (!slot) {
      return NextResponse.json({ error: 'Slot not found' }, { status: 404 })
    }

    return NextResponse.json({ slot })
  } catch (error) {
    if (error instanceof NoSlotUpdatesError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    // `409` — the payload is well-formed, it conflicts with current state.
    if (error instanceof SlotCapacityBelowBookedError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    throw error
  }
}

/**
 * Delete a slot owned by the signed-in organizer.
 *
 * Bookings cascade (see the `time_slots` FK), so this also removes any
 * reservations guests hold on the slot.
 */
export async function DELETE(_request: Request, { params }: RouteContext) {
  const { id } = await params

  const guard = await requireWritableOrganizer()
  if (!guard.ok) return guard.response
  const { organizerId } = guard.value

  const deletedId = await deleteOwnedSlot(organizerId, id)

  if (!deletedId) {
    return NextResponse.json({ error: 'Slot not found' }, { status: 404 })
  }

  return NextResponse.json({ id: deletedId })
}
