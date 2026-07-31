import type { OrganizerProfile, UpdateOrganizerProfileInput } from '@repo/api-contracts'
import { updateOrganizerProfileInput } from '@repo/api-contracts'
import { db, organizers } from '@repo/db'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'

import { auth } from '@/lib/services/auth'
import {
  demoReadOnlyResponse,
  rejectDemoWrite,
  resolveCabinetOrganizerId,
} from '@/lib/services/demo'
import { isOwnMediaUrl } from '@/lib/services/storage/media'

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

  const [row] = await db.select().from(organizers).where(eq(organizers.id, organizerId)).limit(1)

  if (!row) {
    // For the demo id this means the seed has not been run.
    return NextResponse.json(
      { error: isDemo ? 'Demo organizer is not seeded' : 'Organizer not found' },
      { status: 404 },
    )
  }

  const organizer: OrganizerProfile = {
    id: row.id,
    slug: row.slug,
    name: row.name,
    messenger: row.messenger,
    messengerId: row.messengerId,
    timezone: row.timezone,
    description: row.description,
    photoUrl: row.photoUrl,
    location: row.location,
    contact: row.contact,
    createdAt: row.createdAt.toISOString(),
    isDemo,
  }

  return NextResponse.json({ organizer })
}

/**
 * Update the current organizer's profile.
 * Editable fields: name, slug, timezone, description, location, contact, photoUrl.
 * Messenger identity is not editable.
 */
export async function PUT(request: Request) {
  const session = await auth()
  const organizerId = session?.user?.id

  // Read-only demo (ADR-010). Covers both the demo id and anonymous callers —
  // an anonymous request is someone browsing the demo cabinet, so they get the
  // same `DEMO_READ_ONLY` refusal instead of a bare 401. Also narrows
  // `organizerId` to a string for the rest of the handler.
  const denied = rejectDemoWrite(organizerId)
  if (denied || !organizerId) return denied ?? demoReadOnlyResponse()

  const body = await request.json()
  const parsed = updateOrganizerProfileInput.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const input: UpdateOrganizerProfileInput = parsed.data

  // Validate photoUrl if provided (must belong to this organizer's media prefix)
  if (input.photoUrl !== undefined && input.photoUrl !== null) {
    if (!isOwnMediaUrl(organizerId, input.photoUrl)) {
      return NextResponse.json(
        { error: 'Invalid photoUrl: must belong to your media prefix' },
        { status: 400 },
      )
    }
  }

  // Build update object with only provided fields
  const updates: Partial<typeof organizers.$inferInsert> = {}
  if (input.name !== undefined) updates.name = input.name
  if (input.slug !== undefined) updates.slug = input.slug
  if (input.timezone !== undefined) updates.timezone = input.timezone
  if (input.description !== undefined) updates.description = input.description
  if (input.location !== undefined) updates.location = input.location
  if (input.contact !== undefined) updates.contact = input.contact
  if (input.photoUrl !== undefined) updates.photoUrl = input.photoUrl

  const [updated] = await db
    .update(organizers)
    .set(updates)
    .where(eq(organizers.id, organizerId))
    .returning()

  if (!updated) {
    return NextResponse.json({ error: 'Organizer not found' }, { status: 404 })
  }

  const organizer: OrganizerProfile = {
    id: updated.id,
    slug: updated.slug,
    name: updated.name,
    messenger: updated.messenger,
    messengerId: updated.messengerId,
    timezone: updated.timezone,
    description: updated.description,
    photoUrl: updated.photoUrl,
    location: updated.location,
    contact: updated.contact,
    createdAt: updated.createdAt.toISOString(),
    // A successful write means this is not the demo account.
    isDemo: false,
  }

  return NextResponse.json({ organizer })
}
