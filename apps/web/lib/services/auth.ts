import { NextResponse } from 'next/server'
import NextAuth, { type NextAuthResult } from 'next-auth'

import { createTelegramProvider } from './telegram-provider'

/**
 * Auth.js for organizers (ADR-008): messenger-only identity, JWT sessions.
 * `Organizer.id` IS the Auth.js user id — no separate user table.
 *
 * Single provider: **telegram** (Telegram Login Widget, HMAC validation).
 * - Known organizer → session immediately.
 * - Unknown identity → throws SIGNUP_REQUIRED:<ticket> so the client
 *   can redirect to /signup pre-loaded with the widget-validated identity.
 *
 * **Nothing is route-gated here.** `/cabinet` is open to everyone —
 * unauthenticated visitors get the read-only demo cabinet (ADR-010) — so this
 * config guards no pages at all; `authorized` only bounces signed-in organizers
 * away from the auth pages, and the middleware matcher in `proxy.ts` is narrowed
 * to those two routes.
 *
 * Consequences to keep in mind:
 * - A cabinet route does **not** imply an authenticated organizer. Scope cabinet
 *   reads through `resolveCabinetOrganizerId()`.
 * - Write protection lives entirely in the API layer: every mutating endpoint
 *   must check the session itself and reject demo/anonymous callers.
 */
const nextAuth = NextAuth({
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [createTelegramProvider()],
  callbacks: {
    /**
     * Runs only for `/login` and `/signup` (see the matcher in `proxy.ts`).
     * Signed-in organizers have no business on the auth pages → cabinet.
     * Everyone else passes through; no route is access-controlled here.
     */
    authorized({ request, auth }) {
      if (auth?.user) {
        return NextResponse.redirect(new URL('/cabinet', request.url))
      }
      return true
    },
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
export const signOut: NextAuthResult['signOut'] = nextAuth.signOut
