import { db, organizers } from '@repo/db'
import { AuthDataValidator, objectToAuthDataMap } from '@telegram-auth/server'
import { and, eq } from 'drizzle-orm'
import Credentials from 'next-auth/providers/credentials'

import { consumeTicket, issueTicket, TICKET_BASE64URL_LENGTH } from './auth-ticket'

/**
 * Telegram Login Widget provider for Auth.js (ADR-008).
 *
 * Single login path: widget HMAC validation → look up organizer by
 * (messenger='telegram', messengerId). If found → session. If not found →
 * issues a short-lived signup ticket (stored in Redis) and returns an
 * error so the client can redirect to /signup carrying the ticket.
 *
 * The provider also handles the `signIn('telegram', { ticket })` call that
 * the signup page makes after profile completion: it detects a ticket-only
 * credential and consumes it to establish the session.
 */
export function createTelegramProvider() {
  return Credentials({
    id: 'telegram',
    name: 'Telegram',
    credentials: {},
    async authorize(credentials, req) {
      const botToken = process.env.TELEGRAM_BOT_TOKEN
      if (!botToken) {
        console.error('[TelegramProvider] TELEGRAM_BOT_TOKEN is not configured')
        return null
      }

      // ── Ticket-based sign-in (post-signup) ───────────────────────────────
      // After the signup form creates the organizer, it calls
      // signIn('telegram', { ticket }) to establish a session.
      const rawTicket = (credentials as Record<string, unknown>)?.ticket
      if (typeof rawTicket === 'string' && rawTicket.length === TICKET_BASE64URL_LENGTH) {
        const payload = await consumeTicket(rawTicket)
        if (!payload) {
          return null
        }
        const organizer = await db.query.organizers.findFirst({
          where: and(
            eq(organizers.messenger, payload.messenger),
            eq(organizers.messengerId, payload.messengerId),
          ),
        })
        if (!organizer) {
          return null
        }
        return { id: organizer.id, name: organizer.name, slug: organizer.slug }
      }

      // ── Widget-based sign-in ──────────────────────────────────────────────
      try {
        const url = new URL(req.url || '', 'http://localhost')
        const queryParams: Record<string, string> = {}
        url.searchParams.forEach((value, key) => {
          queryParams[key] = value
        })

        const validator = new AuthDataValidator({ botToken })
        const data = objectToAuthDataMap(queryParams)
        const telegramUser = await validator.validate(data)

        if (!telegramUser.id || !telegramUser.first_name) {
          console.error('[TelegramProvider] Invalid widget data')
          return null
        }

        const messengerId = telegramUser.id.toString()

        const organizer = await db.query.organizers.findFirst({
          where: and(eq(organizers.messenger, 'telegram'), eq(organizers.messengerId, messengerId)),
        })

        if (!organizer) {
          // Unknown identity → issue a signup ticket so the client can proceed
          // to the signup form without re-authenticating.
          const ticket = await issueTicket({
            messenger: 'telegram',
            messengerId,
            displayName: [telegramUser.first_name, telegramUser.last_name ?? ''].join(' ').trim(),
            photoUrl: telegramUser.photo_url,
          })
          // Auth.js does not support custom return values on failure, so we
          // encode the ticket in the error string. The client parses it.
          throw new Error(`SIGNUP_REQUIRED:${ticket}`)
        }

        return {
          id: organizer.id,
          name: organizer.name,
          slug: organizer.slug,
          image: organizer.photoUrl ?? telegramUser.photo_url,
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('SIGNUP_REQUIRED:')) {
          throw error
        }
        console.error('[TelegramProvider] Error:', error)
        return null
      }
    },
  })
}
