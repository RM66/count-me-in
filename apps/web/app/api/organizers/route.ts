import { registerOrganizerInput } from '@repo/api-contracts'
import { db, organizers } from '@repo/db'
import { NextResponse } from 'next/server'
import { flattenError } from 'zod'

import { peekTicket } from '@/lib/services/otp'

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = '23505'

/**
 * Register an organizer (ADR-005). The phone comes from the OTP `ticket`
 * (never from the client). The ticket is only *peeked* here — it stays valid
 * so the client can immediately exchange it for a session via Auth.js
 * (`signIn('otp-ticket')` consumes it).
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

  const { ticket, slug, name, timezone, messenger } = parsed.data

  const payload = await peekTicket(ticket)
  if (!payload) {
    return NextResponse.json(
      { error: 'Phone verification expired — verify your phone again' },
      { status: 401 },
    )
  }

  try {
    const [organizer] = await db
      .insert(organizers)
      .values({ slug, name, timezone, messenger, phone: payload.phone })
      .returning({ id: organizers.id, slug: organizers.slug })

    return NextResponse.json({ organizer }, { status: 201 })
  } catch (error) {
    if (isUniqueViolation(error)) {
      const message = error.constraint_name?.includes('phone')
        ? 'An account with this phone already exists — log in instead'
        : 'This handle is already taken — pick another one'
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
