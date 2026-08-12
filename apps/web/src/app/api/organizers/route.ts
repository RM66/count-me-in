import { registerOrganizerInput } from '@repo/contracts'
import { db, organizers } from '@repo/db'
import { NextResponse } from 'next/server'
import { flattenError } from 'zod'

import { peekTicket } from '@/server/auth/ticket'

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = '23505'

/**
 * Register an organizer (ADR-008). The messenger identity comes from the auth
 * `ticket` (validated server-side via Telegram widget HMAC — never from the
 * client). The ticket is only *peeked* here — it stays valid so the client
 * can immediately exchange it for a session via Auth.js
 * (`signIn('telegram', { ticket })` consumes it).
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const parsed = registerOrganizerInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: flattenError(parsed.error).fieldErrors },
      { status: 400 },
    )
  }

  const { ticket, slug, name, timezone, contact } = parsed.data

  const payload = await peekTicket(ticket)
  if (!payload) {
    return NextResponse.json(
      { error: 'Auth session expired — authenticate with Telegram again' },
      { status: 401 },
    )
  }

  try {
    const [organizer] = await db
      .insert(organizers)
      .values({
        slug,
        name,
        timezone,
        contact: contact ?? null,
        messenger: payload.messenger,
        messengerId: payload.messengerId,
        photoUrl: payload.photoUrl ?? null,
      })
      .returning({ id: organizers.id, slug: organizers.slug })

    return NextResponse.json({ organizer }, { status: 201 })
  } catch (error) {
    if (isUniqueViolation(error)) {
      const message = error.constraint_name?.includes('slug')
        ? 'This handle is already taken — pick another one'
        : 'An account with this Telegram identity already exists — log in instead'
      return NextResponse.json({ error: message }, { status: 409 })
    }
    throw error
  }
}

function isUniqueViolation(error: unknown): error is { code: string; constraint_name?: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === UNIQUE_VIOLATION
  )
}
