import type { OrganizerProfile, UpdateOrganizerProfileInput } from '@repo/api-contracts'
import { updateOrganizerProfileInput } from '@repo/api-contracts'
import { db, organizers } from '@repo/db'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'

import { auth } from '@/lib/services/auth'
import { isOwnAvatarUrl } from '@/lib/services/storage/avatar'

/**
 * Current organizer profile for the cabinet.
 * Identity comes from the Auth.js JWT session (`session.user.id` IS the organizer id).
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [row] = await db
    .select()
    .from(organizers)
    .where(eq(organizers.id, session.user.id))
    .limit(1)

  if (!row) {
    return NextResponse.json({ error: 'Organizer not found' }, { status: 404 })
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
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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
    if (!isOwnAvatarUrl(session.user.id, input.photoUrl)) {
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
    .where(eq(organizers.id, session.user.id))
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
  }

  return NextResponse.json({ organizer })
}
