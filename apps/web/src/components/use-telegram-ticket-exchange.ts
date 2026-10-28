'use client'

import type { GuestTicketResponse } from '@repo/contracts'
import { authTicketResponse, guestTicketResponse } from '@repo/contracts'
import { useState } from 'react'

import { post } from '@/api-client/client'
import type { TelegramProof } from './telegram-oidc'

/**
 * The proof → ticket exchange behind TelegramLoginButton (ADR-026).
 *
 * **login**: `organizerExists` → Auth.js sign-in + redirect; otherwise
 * the signup ticket goes to `onSignupRequired` (handed to /signup via
 * sessionStorage — a one-time credential must not land in the URL).
 *
 * **signup**: `onTicketIssued(ticket, organizerExists)` → profile
 * creation or sign-in.
 *
 * **guest**: `/api/auth/telegram-guest` → `onGuestTicket` (ADR-002) — a
 * different endpoint: no session, and the ticket is not a sign-in.
 *
 * `pending` covers the whole POST + sign-in; the reset matters on the
 * error paths (success paths unmount or navigate anyway).
 */
export function useTelegramTicketExchange({
  mode = 'login',
  redirectTo = '/cabinet',
  onSignupRequired,
  onTicketIssued,
  onGuestTicket,
  onError,
}: {
  mode?: 'login' | 'signup' | 'guest'
  redirectTo?: string
  onSignupRequired?: (ticket: string) => void
  onTicketIssued?: (ticket: string, organizerExists: boolean) => void
  onGuestTicket?: (ticket: GuestTicketResponse) => void
  onError?: (err: unknown) => void
}): { pending: boolean; handleProof: (proof: TelegramProof) => Promise<void> } {
  const [pending, setPending] = useState(false)

  async function handleProof({ idToken, nonceVerifier }: TelegramProof) {
    setPending(true)
    try {
      const body = { idToken, nonceVerifier }
      if (mode === 'guest') {
        const data = await post('/api/auth/telegram-guest', body, guestTicketResponse)
        onGuestTicket?.(data)
        return
      }
      const data = await post('/api/auth/telegram-signup', body, authTicketResponse)
      if (mode === 'signup') {
        onTicketIssued?.(data.ticket, data.organizerExists)
        return
      }
      if (data.organizerExists) {
        const { signIn } = await import('next-auth/react')
        const result = await signIn('telegram', { ticket: data.ticket, redirect: false })
        // `result.ok` is the callback's transport status — it is true even
        // when authorize fails, because Auth.js answers 200 and carries the
        // failure in `?error=` inside `data.url`. `error` is the auth result.
        if (result && !result.error) {
          window.location.href = redirectTo
        } else {
          console.error('[TelegramLogin] Sign-in with ticket failed:', result?.error)
          onError?.(result?.error)
        }
      } else {
        onSignupRequired?.(data.ticket)
      }
    } catch (err) {
      console.error(`[TelegramLogin] ${mode} flow error:`, err)
      onError?.(err)
    } finally {
      setPending(false)
    }
  }

  return { pending, handleProof }
}
