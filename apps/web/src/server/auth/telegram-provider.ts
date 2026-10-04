import { isDemoOrganizerId } from '@repo/contracts'
import Credentials from 'next-auth/providers/credentials'

import { getInternalOrganizer } from '@/server/internal-api'
import { consumeLoginLink } from './login-link'
import { consumeTicket, TICKET_BASE64URL_LENGTH } from './ticket'

import 'server-only'

/**
 * Telegram Credentials provider for Auth.js (ADR-008).
 *
 * The widget HMAC itself is validated by the Python API
 * (`/api/auth/telegram-signup`, `/api/auth/telegram-guest`) — the client
 * always exchanges the widget payload there first, so this provider only
 * sees token-shaped credentials that are *already* proof of a validated
 * messenger identity:
 * - `ticket` — the `signIn('telegram', { ticket })` call the signup page
 *   makes after profile completion.
 * - `loginLinkToken` — a one-time link from a notification message
 *   (`/login/link/{token}`), minted by the notification job into the
 *   organizer's own Telegram chat.
 */
export function createTelegramProvider() {
  return Credentials({
    id: 'telegram',
    name: 'Telegram',
    credentials: {},
    async authorize(credentials) {
      // ── One-time login link (notification deep link) ──────────────────────
      const rawLoginLink = (credentials as Record<string, unknown>)?.loginLinkToken
      if (typeof rawLoginLink === 'string' && rawLoginLink.length > 0) {
        const payload = await consumeLoginLink(rawLoginLink)
        if (!payload) {
          return null
        }

        if (isDemoOrganizerId(payload.organizerId)) {
          console.error('[TelegramProvider] Refused a login link for the demo organizer')
          return null
        }

        const organizer = await getInternalOrganizer({ organizerId: payload.organizerId })
        if (!organizer) {
          return null
        }

        return { id: organizer.id, name: organizer.name, slug: organizer.slug }
      }

      // ── Ticket-based sign-in (post-signup) ───────────────────────────────
      const rawTicket = (credentials as Record<string, unknown>)?.ticket
      if (typeof rawTicket === 'string' && rawTicket.length === TICKET_BASE64URL_LENGTH) {
        const payload = await consumeTicket(rawTicket)
        if (!payload || payload.purpose !== 'organizer') {
          // A guest ticket (booking flow) must never be redeemable for an
          // organizer session — tickets are bound to one flow by `purpose`.
          return null
        }
        const organizer = await getInternalOrganizer({
          messenger: payload.messenger,
          messengerId: payload.messengerId,
        })
        if (!organizer) {
          return null
        }
        return { id: organizer.id, name: organizer.name, slug: organizer.slug }
      }

      return null
    },
  })
}
