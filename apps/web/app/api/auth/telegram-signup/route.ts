import { db, organizers } from '@repo/db'
import { and, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'

import { validateTelegramWidget } from '@/lib/server/auth/telegram-widget'
import { issueTicket } from '@/lib/server/auth/ticket'

/**
 * POST /api/auth/telegram-signup
 *
 * Validates the Telegram Login Widget payload via HMAC, then:
 * - If an organizer already exists for this messenger identity → returns
 *   `{ organizerExists: true, ticket }` so the client can sign in directly.
 * - If not → issues a short-lived auth ticket carrying the validated identity
 *   and returns `{ organizerExists: false, ticket }` so the signup form can
 *   proceed to the profile step without re-authenticating.
 *
 * The organizer is **not** created here — the profile form POSTs to
 * /api/organizers once the user fills in name/slug/timezone/contact.
 *
 * Body: Telegram widget auth object (id, first_name, last_name?, username?,
 *       photo_url?, auth_date, hash)
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)

  const validated = await validateTelegramWidget(body)
  if (!validated.ok) return validated.response
  const identity = validated.value

  // Check if an organizer already exists for this identity.
  const existing = await db.query.organizers.findFirst({
    where: and(
      eq(organizers.messenger, identity.messenger),
      eq(organizers.messengerId, identity.messengerId),
    ),
    columns: { id: true },
  })

  const ticket = await issueTicket(identity)

  return NextResponse.json({ ticket, organizerExists: !!existing })
}
