import { updateServiceInput } from '@repo/api-contracts'
import { db, services } from '@repo/db'
import { and, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'

import { auth } from '@/lib/server/auth'
import { getOwnedService, toServiceRecord } from '@/lib/server/db/service'
import {
  demoReadOnlyResponse,
  rejectDemoWrite,
  resolveCabinetOrganizerId,
} from '@/lib/server/demo'
import { isOwnMediaUrl } from '@/lib/server/storage/media'

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

  const session = await auth()
  const organizerId = session?.user?.id

  // Read-only demo (ADR-010). Also narrows `organizerId` to a string.
  const denied = rejectDemoWrite(organizerId)
  if (denied || !organizerId) return denied ?? demoReadOnlyResponse()

  const body = await request.json()
  const parsed = updateServiceInput.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const input = parsed.data

  if (input.photoUrl !== undefined && input.photoUrl !== null) {
    if (!isOwnMediaUrl(organizerId, input.photoUrl)) {
      return NextResponse.json(
        { error: 'Invalid photoUrl: must belong to your media prefix' },
        { status: 400 },
      )
    }
  }

  // Only the keys actually present in the payload are written.
  const updates: Partial<typeof services.$inferInsert> = {}
  if (input.title !== undefined) updates.title = input.title
  if (input.description !== undefined) updates.description = input.description
  if (input.location !== undefined) updates.location = input.location
  if (input.contact !== undefined) updates.contact = input.contact
  if (input.defaultPrice !== undefined) updates.defaultPrice = input.defaultPrice
  if (input.defaultCapacity !== undefined) updates.defaultCapacity = input.defaultCapacity
  if (input.defaultDurationMinutes !== undefined) {
    updates.defaultDurationMinutes = input.defaultDurationMinutes
  }
  if (input.options !== undefined) updates.options = input.options
  if (input.optionsSelectMode !== undefined) updates.optionsSelectMode = input.optionsSelectMode
  if (input.photoUrl !== undefined) updates.photoUrl = input.photoUrl

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  // `organizerId` in the WHERE clause is the ownership check: a foreign id
  // simply matches no row, so there is no read-then-write gap to exploit.
  const [updated] = await db
    .update(services)
    .set(updates)
    .where(and(eq(services.id, id), eq(services.organizerId, organizerId)))
    .returning()

  if (!updated) {
    return NextResponse.json({ error: 'Service not found' }, { status: 404 })
  }

  return NextResponse.json({ service: toServiceRecord(updated) })
}

/**
 * Delete a service owned by the signed-in organizer.
 *
 * Slots and their bookings cascade (see the `services` FK), so this also
 * removes any scheduled sessions.
 */
export async function DELETE(_request: Request, { params }: RouteContext) {
  const { id } = await params

  const session = await auth()
  const organizerId = session?.user?.id

  const denied = rejectDemoWrite(organizerId)
  if (denied || !organizerId) return denied ?? demoReadOnlyResponse()

  const [deleted] = await db
    .delete(services)
    .where(and(eq(services.id, id), eq(services.organizerId, organizerId)))
    .returning()

  if (!deleted) {
    return NextResponse.json({ error: 'Service not found' }, { status: 404 })
  }

  return NextResponse.json({ id: deleted.id })
}
