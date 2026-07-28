'use client'

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

  // ── Login mode ───────────────────────────────────────────────────────────────
  /** Redirect on successful login (default: /cabinet). Only used in login mode. */
  redirectTo?: string
  /**
   * Called when the widget auth succeeds but no organizer exists for the identity.
   * Receives the signup ticket so the caller can redirect to /signup?ticket=…
   * Only used in login mode.
   */
  onSignupRequired?: (ticket: string) => void

  // ── Signup mode ──────────────────────────────────────────────────────────────
  /**
   * Set to `'signup'` to run the ticket-issuance flow instead of direct sign-in.
   * The component will POST to /api/auth/telegram-signup and call `onTicketIssued`.
   */
  mode?: 'login' | 'signup'
  /**
   * Called after the server validates the widget payload and issues a ticket.
   * `organizerExists` is true if the identity is already registered (login path).
   * Only used in signup mode.
   */
  onTicketIssued?: (ticket: string, organizerExists: boolean) => void
}

/**
 * Telegram Login Widget component (ADR-008).
 *
 * Both modes POST widget data to `/api/auth/telegram-signup` which validates
 * the HMAC server-side and returns a short-lived auth ticket plus whether an
 * organizer already exists for this identity.
 *
 * **Login mode** (default): if `organizerExists` → signs in via Auth.js with
 * the ticket and redirects. If not → calls `onSignupRequired(ticket)` so the
 * page can show a toast and redirect to /signup.
 *
 * **Signup mode**: calls `onTicketIssued(ticket, organizerExists)` so the page
 * can either proceed to profile creation or sign in directly.
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
}: TelegramLoginButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const callbackName = useRef(`onTelegramAuth_${Math.random().toString(36).substring(7)}`)

  useEffect(() => {
    const container = containerRef.current
    const callback = callbackName.current

    if (!container || !botUsername) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any)[callback] = async (user: TelegramUser) => {
      if (mode === 'signup') {
        // ── Signup flow: validate via our API, get a ticket ──────────────────
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
          onTicketIssued?.(data.ticket, data.organizerExists ?? false)
        } catch (err) {
          console.error('[TelegramLoginButton] Signup fetch error:', err)
        }
      } else {
        // ── Login flow: validate via our API, then sign in or redirect ────────
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
            // Known organizer → sign in with the ticket and redirect
            const { signIn } = await import('next-auth/react')
            const result = await signIn('telegram', { ticket: data.ticket, redirect: false })
            if (result?.ok) {
              window.location.href = redirectTo
            } else {
              console.error('[TelegramLoginButton] Sign-in with ticket failed:', result?.error)
            }
          } else {
            // Unknown identity → notify the page to show toast + redirect to signup
            onSignupRequired?.(data.ticket)
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
  }, [
    botUsername,
    buttonSize,
    cornerRadius,
    requestAccess,
    usePic,
    redirectTo,
    mode,
    onSignupRequired,
    onTicketIssued,
  ])

  return <div ref={containerRef} className={className} />
}
