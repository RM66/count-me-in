import { db, organizers } from '@repo/db'
import { eq } from 'drizzle-orm'
import NextAuth, { type NextAuthResult } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'

import { consumeTicket, TICKET_BASE64URL_LENGTH } from './otp'

/**
 * Auth.js for organizers (ADR-005): phone + messenger OTP, JWT sessions.
 * `Organizer.id` IS the Auth.js user id — no separate user table.
 *
 * The credentials provider does not see raw OTP codes: the client first calls
 * `/api/otp/verify`, gets a one-time `ticket`, and exchanges it here. The
 * ticket is consumed atomically so it cannot be replayed.
 */
const nextAuth = NextAuth({
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      id: 'otp-ticket',
      credentials: { ticket: {} },
      async authorize(credentials) {
        const ticket = credentials?.ticket
        if (typeof ticket !== 'string' || ticket.length !== TICKET_BASE64URL_LENGTH) {
          return null
        }

        const payload = await consumeTicket(ticket)
        if (!payload) {
          return null
        }

        const organizer = await db.query.organizers.findFirst({
          where: eq(organizers.phone, payload.phone),
        })
        if (!organizer) {
          return null
        }

        return { id: organizer.id, name: organizer.name, slug: organizer.slug }
      },
    }),
  ],
  callbacks: {
    authorized({ auth }) {
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
