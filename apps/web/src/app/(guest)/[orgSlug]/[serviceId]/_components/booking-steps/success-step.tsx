'use client'

import type { GuestBooking } from '@repo/contracts'
import { effectiveLocation, slotEnd } from '@repo/contracts'
import { CheckCircle2, PartyPopper } from 'lucide-react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'

import { AddToCalendar } from '@/app/(guest)/_components/add-to-calendar'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { formatDate, formatTime } from '@/helpers/date'

/**
 * Step 5: the confirmation screen.
 *
 * Deliberately does not promise a message: the notification worker is still a
 * stub (ADR-004), so the management link below is the guest's only way back to
 * this booking. Restore the "we've sent the details" line when
 * `booking.created` actually dispatches.
 */
export function SuccessStep({ booking }: { booking: GuestBooking }) {
  const t = useTranslations('SuccessStep')
  const locale = useLocale()

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-2 py-2 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <PartyPopper className="size-6" />
        </span>
        <p className="text-sm text-muted-foreground text-pretty">{t('confirmedNote')}</p>
      </div>

      <div className="rounded-lg border bg-muted/30 p-4 text-sm">
        <dl className="flex flex-col gap-2">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{t('service')}</dt>
            <dd className="text-right font-medium">{booking.service.title}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{t('when')}</dt>
            <dd className="text-right font-medium">
              {formatDate(booking.slot.startsAt, booking.organizer.timezone, locale)} ·{' '}
              {formatTime(booking.slot.startsAt, booking.organizer.timezone, locale)}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{t('name')}</dt>
            <dd className="text-right font-medium">{booking.guestName}</dd>
          </div>
          {booking.selectedOptions?.length ? (
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{t('options')}</dt>
              <dd className="text-right font-medium">{booking.selectedOptions.join(', ')}</dd>
            </div>
          ) : null}
          <Separator className="my-1" />
          <div className="flex items-center gap-2 text-primary">
            <CheckCircle2 className="size-4" />
            <span className="font-medium">{t('confirmed')}</span>
          </div>
        </dl>
      </div>

      <div className="flex flex-col gap-2">
        <AddToCalendar
          title={booking.service.title}
          startsAt={booking.slot.startsAt}
          endsAt={slotEnd(booking.slot)}
          location={effectiveLocation(booking.service, booking.organizer)}
          variant="default"
        />
        {/*
          The real `manageToken` from the response — this link is the guest's
          only way back to the booking if the message is lost.
        */}
        <Button variant="outline" asChild>
          <Link href={`/booking/${booking.manageToken}`}>{t('manageThisBooking')}</Link>
        </Button>
      </div>
    </div>
  )
}
