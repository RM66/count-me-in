import NextAuth, { type NextAuthResult } from 'next-auth'

import { createTelegramProvider } from './telegram-provider'

import 'server-only'

/**
 * Auth.js for organizers (ADR-008): messenger-only identity, JWT sessions.
 * `Organizer.id` IS the Auth.js user id — no separate user table.
 *
 * Single provider: **telegram** (Telegram Login Widget). The widget HMAC is
 * validated by the Python API (`/api/auth/telegram-*`), which answers an
 * auth ticket; the provider redeems ticket/login-link credentials into
 * sessions.
 *
 * **Nothing is route-gated here.** `/cabinet` is open to everyone —
 * unauthenticated visitors get the read-only demo cabinet (ADR-010) — so
 * this config guards no pages at all. `proxy.ts` calls `auth()` itself and
 * re-implements the `/login`/`/signup` redirect; `authorized` is
 * deliberately absent (it only fires when `auth` is used *as* middleware).
 *
 * Consequences to keep in mind:
 * - A cabinet route does **not** imply an authenticated organizer. Cabinet
 *   reads are scoped by the API via the `X-Organizer-Auth` header
 *   (anonymous callers get demo scope; `profile.isDemo` is the read-only
 *   signal).
 * - Write protection lives entirely in the API layer: every mutating endpoint
 *   must check the session itself and reject demo/anonymous callers.
 */
const nextAuth = NextAuth({
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [createTelegramProvider()],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.sub = user.id
        token.slug = user.slug
      }
      return token
    },
    session({ session, token }) {
      if (token.sub) {
        session.user.id = token.sub
      }
      session.user.slug = typeof token.slug === 'string' ? token.slug : undefined
      return session
    },
  },
})

// Explicit annotations keep the exported types portable (avoids TS2742 with Bun's nested store).
export const handlers: NextAuthResult['handlers'] = nextAuth.handlers
export const auth: NextAuthResult['auth'] = nextAuth.auth
export const signIn: NextAuthResult['signIn'] = nextAuth.signIn
