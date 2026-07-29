import type { OrganizerProfile } from '@repo/api-contracts'
import { db, organizers } from '@repo/db'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'

import { auth } from '@/lib/services/auth'

/**
 * Current organizer profile for the cabinet.
 * Identity comes from the Auth.js JWT session (`session.user.id` IS the organizer id).
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
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
