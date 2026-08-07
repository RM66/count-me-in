'use client'

import type { GuestTicketResponse } from '@repo/api-contracts'
import { useEffect, useRef } from 'react'

interface TelegramUser {
  id: number
  first_name: string
  last_name?: string
  username?: string
  photo_url?: string
  auth_date: number
  hash: string
}

interface TelegramLoginButtonProps {
  botUsername: string
  buttonSize?: 'large' | 'medium' | 'small'
  cornerRadius?: number
  requestAccess?: boolean
  usePic?: boolean
  className?: string

  /** Redirect on successful login (default: /cabinet). Only used in login mode. */
  redirectTo?: string
  /**
   * Called when the widget auth succeeds but no organizer exists for the identity.
   * Receives the signup ticket so the caller can redirect to /signup?ticket=…
   */
  onSignupRequired?: (ticket: string) => void

  /**
   * Set to `'signup'` to run the ticket-issuance flow instead of direct sign-in,
   * or `'guest'` for the booking flow (no organizer account, no session).
   */
  mode?: 'login' | 'signup' | 'guest'
  /**
   * Called after the server validates the widget payload and issues a ticket.
   * `organizerExists` is true if the identity is already registered.
   */
  onTicketIssued?: (ticket: string, organizerExists: boolean) => void

  /**
   * Called with the guest ticket and the identity behind it (ADR-002).
   * Only used in guest mode — the caller spends the ticket on a booking or a
   * lookup; it is single-use and short-lived, so it should not be held.
   */
  onGuestTicket?: (ticket: GuestTicketResponse) => void
}

/**
 * Telegram Login Widget component (ADR-008).
 *
 * Both modes POST widget data to `/api/auth/telegram-signup` which validates
 * the HMAC server-side and returns a short-lived auth ticket plus whether an
 * organizer already exists for this identity.
 *
 * **Login mode** (default): if `organizerExists` → signs in via Auth.js with
 * the ticket and redirects. If not → calls `onSignupRequired(ticket)`.
 *
 * **Signup mode**: calls `onTicketIssued(ticket, organizerExists)` so the page
 * can either proceed to profile creation or sign in directly.
 *
 * **Guest mode**: posts to `/api/auth/telegram-guest` and calls
 * `onGuestTicket` — the booking flow (ADR-002). Deliberately a different
 * endpoint from the organizer modes: a guest gets no session, and its ticket
 * cannot be redeemed as a sign-in.
 *
 * @see https://core.telegram.org/widgets/login
 */
export function TelegramLoginButton({
  botUsername,
  buttonSize = 'large',
  cornerRadius,
  requestAccess = true,
  usePic = true,
  className,
  redirectTo = '/cabinet',
  onSignupRequired,
  mode = 'login',
  onTicketIssued,
  onGuestTicket,
}: TelegramLoginButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const callbackName = useRef(`onTelegramAuth_${Math.random().toString(36).substring(7)}`)

  // Callbacks stored in refs so the widget-creation effect doesn't re-run on
  // parent re-renders (which would tear down and re-create the widget script,
  // re-firing its auth callback).
  const onGuestTicketRef = useRef(onGuestTicket)
  const onTicketIssuedRef = useRef(onTicketIssued)
  const onSignupRequiredRef = useRef(onSignupRequired)
  onGuestTicketRef.current = onGuestTicket
  onTicketIssuedRef.current = onTicketIssued
  onSignupRequiredRef.current = onSignupRequired

  // Dedup: the widget can fire its callback twice for one tap. Each auth event
  // has a unique `hash`, so a repeat with the same hash is dropped.
  const lastAuthHash = useRef<string | null>(null)

  useEffect(() => {
    const container = containerRef.current
    const callback = callbackName.current

    if (!container || !botUsername) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any)[callback] = async (user: TelegramUser) => {
      if (lastAuthHash.current === user.hash) return
      lastAuthHash.current = user.hash

      if (mode === 'guest') {
        try {
          const response = await fetch('/api/auth/telegram-guest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(user),
          })
          const data = (await response.json()) as GuestTicketResponse & { error?: string }
          if (!response.ok || !data.ticket) {
            console.error('[TelegramLoginButton] Guest ticket error:', data.error)
            return
          }
          onGuestTicketRef.current?.(data)
        } catch (err) {
          console.error('[TelegramLoginButton] Guest fetch error:', err)
        }
      } else if (mode === 'signup') {
        try {
          const response = await fetch('/api/auth/telegram-signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(user),
          })
          const data = (await response.json()) as {
            ticket?: string
            organizerExists?: boolean
            error?: string
          }
          if (!response.ok || !data.ticket) {
            console.error('[TelegramLoginButton] Signup ticket error:', data.error)
            return
          }
          onTicketIssuedRef.current?.(data.ticket, data.organizerExists ?? false)
        } catch (err) {
          console.error('[TelegramLoginButton] Signup fetch error:', err)
        }
      } else {
        try {
          const response = await fetch('/api/auth/telegram-signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(user),
          })
          const data = (await response.json()) as {
            ticket?: string
            organizerExists?: boolean
            error?: string
          }

          if (!response.ok || !data.ticket) {
            console.error('[TelegramLoginButton] Login validation error:', data.error)
            return
          }

          if (data.organizerExists) {
            const { signIn } = await import('next-auth/react')
            const result = await signIn('telegram', { ticket: data.ticket, redirect: false })
            if (result?.ok) {
              window.location.href = redirectTo
            } else {
              console.error('[TelegramLoginButton] Sign-in with ticket failed:', result?.error)
            }
          } else {
            onSignupRequiredRef.current?.(data.ticket)
          }
        } catch (err) {
          console.error('[TelegramLoginButton] Login fetch error:', err)
        }
      }
    }

    const script = document.createElement('script')
    script.src = 'https://telegram.org/js/telegram-widget.js?22'
    script.async = true
    script.setAttribute('data-telegram-login', botUsername)
    script.setAttribute('data-size', buttonSize)
    script.setAttribute('data-onauth', `${callback}(user)`)
    script.setAttribute('data-request-access', requestAccess ? 'write' : '')

    if (cornerRadius !== undefined) {
      script.setAttribute('data-radius', cornerRadius.toString())
    }
    if (!usePic) {
      script.setAttribute('data-userpic', 'false')
    }

    container.appendChild(script)

    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any)[callback]
      if (container) container.innerHTML = ''
    }
  }, [botUsername, buttonSize, cornerRadius, requestAccess, usePic, redirectTo, mode])

  return <div ref={containerRef} className={className} />
}
