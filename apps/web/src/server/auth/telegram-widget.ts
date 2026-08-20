/**
 * Server-side validation of a Telegram Login Widget payload (ADR-008).
 *
 * Extracted because **two** endpoints now start the same way — organizer signup
 * and guest booking — and each one re-implementing the HMAC check is how one of
 * them ends up trusting the client. The widget payload is attacker-controlled
 * until `validate()` has run against the bot token; only the value returned here
 * may be persisted.
 */

import { telegramWidgetPayload } from '@repo/contracts'
import { AuthDataValidator, objectToAuthDataMap } from '@telegram-auth/server'
import { NextResponse } from 'next/server'
import { getTranslations } from 'next-intl/server'

import type { Guarded } from '../http'
import type { AuthTicketPayload } from './ticket'

import 'server-only'

/**
 * A validated Telegram identity, mapped onto the fields the rest of the app
 * speaks in (`messenger` + `messengerId`, ADR-008) rather than Telegram's own
 * snake_case shape.
 */
export type ValidatedTelegramIdentity = Required<Pick<AuthTicketPayload, 'messenger'>> &
  AuthTicketPayload

/**
 * Parse and HMAC-validate a widget payload from a request body.
 * Returns a {@link Guarded} so route handlers keep their single-expression
 * opening — check `.ok`, never truthiness. Failures are `400`: the payload is
 * malformed or unsigned, which is a bad request rather than an expired session.
 * A missing `TELEGRAM_BOT_TOKEN` is the one `500` here.
 */
export async function validateTelegramWidget(
  body: unknown,
): Promise<Guarded<ValidatedTelegramIdentity>> {
  const t = await getTranslations('ApiErrors')

  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) {
    return {
      ok: false,
      response: NextResponse.json({ error: t('telegramNotConfigured') }, { status: 500 }),
    }
  }

  const parsed = telegramWidgetPayload.safeParse(body)
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json({ error: t('telegramInvalid') }, { status: 400 }),
    }
  }

  try {
    const validator = new AuthDataValidator({ botToken })
    await validator.validate(objectToAuthDataMap(body as Record<string, string>))
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: t('telegramValidationFailed') }, { status: 400 }),
    }
  }

  const widget = parsed.data

  return {
    ok: true,
    value: {
      messenger: 'telegram',
      messengerId: widget.id.toString(),
      displayName: [widget.first_name, widget.last_name ?? ''].join(' ').trim(),
      photoUrl: widget.photo_url,
      messengerLogin: widget.username ? `@${widget.username}` : undefined,
    },
  }
}
