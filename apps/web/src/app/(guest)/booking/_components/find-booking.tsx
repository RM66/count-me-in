'use client'

import type { GuestBooking } from '@repo/contracts'
import { ArrowRightIcon, CalendarIcon, SearchIcon } from 'lucide-react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import { toast } from 'sonner'

import { useLookupBookings } from '@/api-client'
import { TelegramLoginButton } from '@/components/telegram-login-button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'
import { formatDateTime } from '@/helpers/date'

/**
 * "Find my booking" — the fallback when the messenger deep link is lost
 * (ADR-002, entry path 2).
 *
 * Identity comes from the Telegram widget, not from a typed-in phone number:
 * ADR-008 removed phone/OTP entirely, and a self-declared number would let
 * anyone list someone else's bookings. The guest taps once, the server matches
 * `(guestMessenger, guestMessengerId)`, and every result carries its own
 * `manageToken` so each row can link straight to its management page.
 */
export function FindBooking() {
  const lookupBookings = useLookupBookings()
  const t = useTranslations('MyBookings')
  const locale = useLocale()

  /**
   * `null` before the first lookup, an array after — the distinction is what
   * separates "nothing searched yet" from "searched, found nothing", which are
   * different screens.
   */
  const [found, setFound] = useState<GuestBooking[] | null>(null)

  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-12 md:py-20">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-balance md:text-3xl">
          {t('title')}
        </h1>
        <p className="mt-2 text-muted-foreground text-pretty">{t('subtitle')}</p>
      </div>

      {found === null && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 pt-6">
            {lookupBookings.isPending ? (
              <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                <Spinner />
                {t('lookingUp')}
              </div>
            ) : botUsername ? (
              <TelegramLoginButton
                botUsername={botUsername}
                buttonSize="large"
                mode="guest"
                onGuestTicket={async (ticket) => {
                  try {
                    setFound(
                      await lookupBookings.mutateAsync({
                        ticket: ticket.ticket,
                        messenger: ticket.messenger,
                        messengerId: ticket.messengerId,
                      }),
                    )
                  } catch (error) {
                    toast.error(
                      error instanceof Error
                        ? error.message || t('lookupFailed')
                        : t('lookupFailed'),
                    )
                  }
                }}
              />
            ) : (
              <p className="text-center text-sm text-destructive">{t('notConfigured')}</p>
            )}
            <p className="text-center text-sm text-muted-foreground">{t('onlyThisAccount')}</p>
          </CardContent>
        </Card>
      )}

      {found !== null && found.length > 0 && (
        <div className="mt-8 flex flex-col gap-3">
          <p className="text-sm font-medium text-muted-foreground">
            {t('bookingsFound', { count: found.length })}
          </p>
          {found.map((booking) => (
            <Link key={booking.id} href={`/booking/${booking.manageToken}`} className="group block">
              <Card className="transition-colors group-hover:border-primary/40">
                <CardContent className="flex items-center gap-4 py-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
                    <CalendarIcon className="size-5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{booking.service.title}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {/* The organizer's zone — the guest booked a wall-clock time. */}
                      {formatDateTime(booking.slot.startsAt, booking.organizer.timezone, locale)}
                    </p>
                  </div>
                  {/*
                    Cancelled bookings stay in the list: a guest checking whether
                    a cancellation went through needs to see it.
                  */}
                  <Badge variant={booking.status === 'confirmed' ? 'secondary' : 'outline'}>
                    {booking.status === 'confirmed'
                      ? t('seats', { count: booking.seats })
                      : t('cancelled')}
                  </Badge>
                  <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {found !== null && found.length === 0 && (
        <div className="mt-8">
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchIcon />
              </EmptyMedia>
              <EmptyTitle>{t('noBookingsFound')}</EmptyTitle>
              <EmptyDescription>{t('noBookingsDescription')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      )}

      {found === null && !lookupBookings.isPending && (
        <div className="mt-8">
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchIcon />
              </EmptyMedia>
              <EmptyTitle>{t('nothingYet')}</EmptyTitle>
              <EmptyDescription>{t('nothingYetDescription')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      )}
    </div>
  )
}
