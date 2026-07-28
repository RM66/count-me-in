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
 */
const nextAuth = NextAuth({
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [createTelegramProvider()],
  callbacks: {
    authorized({ request, auth }) {
      const { pathname } = request.nextUrl
      const isAuthPage = pathname === '/login' || pathname === '/signup'

      // Auth pages: allow unauthenticated, redirect authenticated to cabinet.
      if (isAuthPage) {
        if (auth?.user) {
          return NextResponse.redirect(new URL('/cabinet', request.url))
        }
        return true
      }

      // Protected pages (cabinet): require authentication.
      return !!auth?.user
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
