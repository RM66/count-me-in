'use client'

import type { GuestTicketResponse, PublicOrganizer } from '@repo/contracts'
import { AlertCircle } from 'lucide-react'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

import { TelegramLoginButton } from '@/components/telegram-login-button'
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
  onBack: () => void
}) {
  return (
    <div className="flex flex-col gap-4">
      {organizer.isDemo ? (
        <div className="flex items-start gap-3 rounded-lg border border-dashed bg-muted/50 p-3 text-sm text-muted-foreground">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <p className="text-pretty">
            This is a read-only demo page, so bookings are not saved.{' '}
            <Link href="/signup" className="font-medium text-foreground underline">
              Create your own
            </Link>{' '}
            to take real bookings.
          </p>
        </div>
      ) : (
        <>
          {error && (
            <div
              role="alert"
              className="flex flex-col gap-2 rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive"
            >
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <p className="text-pretty">{error}</p>
              </div>
              {isDuplicate && (
                <Link
                  href="/booking"
                  className="self-start rounded-md bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive underline-offset-2 hover:underline"
                >
                  Find my bookings →
                </Link>
              )}
            </div>
          )}
          {!attempted && (
            <p className="text-center text-sm text-muted-foreground text-pretty">
              Confirm with Telegram — no account needed, and it only proves who you are.
            </p>
          )}
          {botUsername ? (
            <div className="flex justify-center">
              {isCreating ? (
                <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
                  <Spinner />
                  Reserving your seat…
                </div>
              ) : attempted ? null : (
                <TelegramLoginButton
                  botUsername={botUsername}
                  buttonSize="large"
                  mode="guest"
                  onGuestTicket={onTicket}
                />
              )}
            </div>
          ) : (
            <p className="text-center text-sm text-destructive">
              Telegram login is not configured, so booking is unavailable.
            </p>
          )}
        </>
      )}
      <Button variant="ghost" disabled={isCreating} onClick={onBack}>
        <ArrowLeft data-icon="inline-start" />
        Back
      </Button>
    </div>
  )
}
