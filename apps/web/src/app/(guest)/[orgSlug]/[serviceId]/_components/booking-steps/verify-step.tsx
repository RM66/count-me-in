'use client'

import type { GuestTicketResponse, PublicOrganizer } from '@repo/contracts'
import { AlertCircle } from 'lucide-react'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'

import { TelegramLoginButton } from '@/components/telegram-login-button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

/**
 * Step 4: confirm identity with Telegram.
 *
 * The demo organizer is read-only (ADR-010). The API refuses the write
 * regardless — this only spares the guest a Telegram tap before being told so.
 */
export function VerifyStep({
  organizer,
  error,
  isDuplicate,
  isCreating,
  attempted,
  botUsername,
  onTicket,
  onTicketError,
  onBack,
}: {
  organizer: PublicOrganizer
  error: string | null
  /** Whether `error` is a duplicate-booking 409 — shows a "find my bookings" link. */
  isDuplicate: boolean
  isCreating: boolean
  /** Whether the guest has already tapped Telegram — keeps the button hidden after. */
  attempted: boolean
  botUsername?: string
  onTicket: (ticket: GuestTicketResponse) => void
  /** Widget-side failure before a ticket exists — nothing was consumed. */
  onTicketError: (err: unknown) => void
  onBack: () => void
}) {
  const t = useTranslations('Booking')

  return (
    <div className="flex flex-col gap-4">
      {organizer.isDemo ? (
        <Alert className="border-dashed bg-muted/50">
          <AlertCircle className="text-muted-foreground" />
          <AlertDescription>
            {t('demoIntro')}{' '}
            <Link href="/signup" className="font-medium text-foreground">
              {t('createOwn')}
            </Link>{' '}
            {t('demoOutro')}
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {error && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription className="flex flex-col gap-2">
                {error}
                {isDuplicate && (
                  <Link
                    href="/booking"
                    className="self-start rounded-md bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive"
                  >
                    {t('findMyBookings')}
                  </Link>
                )}
              </AlertDescription>
            </Alert>
          )}
          {!attempted && (
            <p className="text-center text-sm text-muted-foreground text-pretty">
              {t('confirmHint')}
            </p>
          )}
          {botUsername ? (
            <div className="flex justify-center">
              {isCreating ? (
                <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
                  <Spinner />
                  {t('reserving')}
                </div>
              ) : attempted ? null : (
                <TelegramLoginButton
                  botUsername={botUsername}
                  buttonSize="large"
                  mode="guest"
                  onGuestTicket={onTicket}
                  onError={onTicketError}
                />
              )}
            </div>
          ) : (
            <p className="text-center text-sm text-destructive">{t('notConfigured')}</p>
          )}
        </>
      )}
      <Button variant="ghost" disabled={isCreating} onClick={onBack}>
        <ArrowLeft data-icon="inline-start" />
        {t('back')}
      </Button>
    </div>
  )
}
