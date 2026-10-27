'use client'

import type { GuestTicketResponse } from '@repo/contracts'
import { useLocale, useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { useTelegramLogin } from './use-telegram-login'
import { useTelegramTicketExchange } from './use-telegram-ticket-exchange'

type TelegramLoginButtonProps = {
  /** The bot's OIDC Client ID (NEXT_PUBLIC_TELEGRAM_CLIENT_ID) — equals the bot id. */
  clientId: string

  /** Post-proof round-trip failures (ticket POST, sign-in) — alongside console.error. */
  onError?: (err: unknown) => void
} & (
  | {
      /** Direct sign-in (default). */
      mode?: 'login'
      /** Redirect on successful login (default: /cabinet). */
      redirectTo?: string
      /**
       * Called when Telegram auth succeeds but no organizer exists —
       * receives the signup ticket; the caller hands it to /signup via
       * sessionStorage (a one-time credential must not land in the URL).
       */
      onSignupRequired: (ticket: string) => void
    }
  | {
      /** Ticket issuance for the signup flow instead of direct sign-in. */
      mode: 'signup'
      /** `organizerExists` is true if the identity is already registered. */
      onTicketIssued: (ticket: string, organizerExists: boolean) => void
    }
  | {
      /** The booking flow — a guest ticket, no session (ADR-002). */
      mode: 'guest'
      /** Single-use and short-lived — the caller spends it, does not hold it. */
      onGuestTicket: (ticket: GuestTicketResponse) => void
    }
)

/** The exchange args for the mode's branch of the props union. */
function exchangeArgs(
  props: TelegramLoginButtonProps,
): Parameters<typeof useTelegramTicketExchange>[0] {
  switch (props.mode) {
    case 'guest':
      return { mode: 'guest', onGuestTicket: props.onGuestTicket, onError: props.onError }
    case 'signup':
      return { mode: 'signup', onTicketIssued: props.onTicketIssued, onError: props.onError }
    default:
      return {
        mode: 'login',
        redirectTo: props.redirectTo,
        onSignupRequired: props.onSignupRequired,
        onError: props.onError,
      }
  }
}

/**
 * Telegram OIDC login button (ADR-026).
 *
 * Keeps a nonce-bound verifier, opens the consent popup (or the in-app
 * flow inside the Telegram WebView), POSTs `{idToken, nonceVerifier}`.
 * Mount at most one instance per page — the delivery paths are
 * singletons.
 *
 * @see https://core.telegram.org/bots/telegram-login
 */
export function TelegramLoginButton(props: TelegramLoginButtonProps) {
  const { clientId } = props
  const mode = props.mode ?? 'login'
  const t = useTranslations('TelegramLogin')
  const locale = useLocale()
  const { pending, handleProof } = useTelegramTicketExchange(exchangeArgs(props))

  const { status, loadFailed, popupBlocked, authFailed, inAppFailed, retry, onClick } =
    useTelegramLogin({
      clientId,
      lang: locale,
      onResult: (proof) => {
        void handleProof(proof)
      },
    })

  // The component owns its vertical layout — callers may mount it
  // inside a horizontal flex row (VerifyStep).
  if (status === 'config' || status === 'unavailable') {
    return (
      <div className="flex flex-col items-center gap-2">
        <p className="text-center text-sm text-destructive" role="alert">
          {status === 'config' ? t('notConfigured') : t('unavailable')}
        </p>
      </div>
    )
  }

  // A failed lib load does not block the flow — the click falls back
  // to the manual popup; the hint + retry stay offered.
  return (
    <div className="flex flex-col items-center gap-2">
      {loadFailed && (
        <p className="text-center text-sm text-destructive" role="alert">
          {t('loadFailed')}
        </p>
      )}
      {popupBlocked && (
        <p className="text-center text-sm text-destructive" role="alert">
          {t('popupBlocked')}
        </p>
      )}
      {authFailed && (
        <p className="text-center text-sm text-destructive" role="alert">
          {t('authFailed')}
        </p>
      )}
      {inAppFailed && (
        <p className="text-center text-sm text-destructive" role="alert">
          {t('inAppFailed')}
        </p>
      )}
      <Button type="button" size="lg" onClick={onClick} disabled={status !== 'ready' || pending}>
        {mode === 'guest' ? t('buttonGuest') : t('button')}
      </Button>
      {loadFailed && (
        <Button variant="outline" size="sm" onClick={retry} className="w-full">
          {t('retry')}
        </Button>
      )}
    </div>
  )
}
