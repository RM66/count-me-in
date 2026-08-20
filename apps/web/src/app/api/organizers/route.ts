import { registerOrganizerInput } from '@repo/contracts'
import { db, organizers } from '@repo/db'
import { NextResponse } from 'next/server'
import { getTranslations } from 'next-intl/server'
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
  const t = await getTranslations('ApiErrors')
  const body = await request.json().catch(() => null)
  const parsed = registerOrganizerInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: t('invalidInput'), issues: flattenError(parsed.error).fieldErrors },
      { status: 400 },
    )
  }

  const { ticket, slug, name, timezone, contact, language } = parsed.data

  const payload = await peekTicket(ticket)
  if (!payload) {
    return NextResponse.json({ error: t('authSessionExpired') }, { status: 401 })
  }

  try {
    const [organizer] = await db
      .insert(organizers)
      .values({
        slug,
        name,
        timezone,
        contact: contact ?? null,
        // Notification language (ADR-011) — the signup form sends the browser locale.
        language,
        messenger: payload.messenger,
        messengerId: payload.messengerId,
        photoUrl: payload.photoUrl ?? null,
      })
      .returning({ id: organizers.id, slug: organizers.slug })

    return NextResponse.json({ organizer }, { status: 201 })
  } catch (error) {
    if (isUniqueViolation(error)) {
      const message = error.constraint_name?.includes('slug') ? t('slugTaken') : t('accountExists')
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
