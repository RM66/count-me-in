import { telegramWidgetPayload } from '@repo/api-contracts'
import { db, organizers } from '@repo/db'
import { AuthDataValidator, objectToAuthDataMap } from '@telegram-auth/server'
import { and, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'

import { issueTicket } from '@/lib/services/auth-ticket'

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
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) {
    return NextResponse.json({ error: 'Telegram bot not configured' }, { status: 500 })
  }

  const body = await request.json().catch(() => null)
  const parsed = telegramWidgetPayload.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid Telegram auth data' }, { status: 400 })
  }

  const widgetData = parsed.data

  // Validate HMAC using the bot token.
  try {
    const validator = new AuthDataValidator({ botToken })
    const dataMap = objectToAuthDataMap(body as Record<string, string>)
    await validator.validate(dataMap)
  } catch {
    return NextResponse.json({ error: 'Telegram auth validation failed' }, { status: 400 })
  }

  const messengerId = widgetData.id.toString()
  const displayName = [widgetData.first_name, widgetData.last_name ?? ''].join(' ').trim()
  // Telegram username as the human-readable login (e.g. @alice). May be absent.
  const messengerLogin = widgetData.username ? `@${widgetData.username}` : undefined

  // Check if an organizer already exists for this identity.
  const existing = await db.query.organizers.findFirst({
    where: and(eq(organizers.messenger, 'telegram'), eq(organizers.messengerId, messengerId)),
    columns: { id: true },
  })

  const ticket = await issueTicket({
    messenger: 'telegram',
    messengerId,
    displayName,
    photoUrl: widgetData.photo_url,
    messengerLogin,
  })

  return NextResponse.json({ ticket, organizerExists: !!existing })
}
