'use client'

import type { GuestBooking } from '@repo/contracts'
import { ArrowRightIcon, CalendarIcon } from 'lucide-react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { formatDateTime } from '@/helpers/date'

type BookingListItemProps = {
  booking: GuestBooking
}

/**
 * One row of "Find my booking". The card links to the management page
 * while `canCancel` says the manage token is live; an expired token
 * (slot start + 24h, ADR-020) renders the same row without the link —
 * the history stays visible, the dead action does not.
 *
 * Cancelled bookings stay in the list either way: a guest checking
 * whether a cancellation went through needs to see it.
 */
export function BookingListItem({ booking }: BookingListItemProps) {
  const t = useTranslations('MyBookings')
  const locale = useLocale()

  const card = (
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
        <Badge variant={booking.status === 'confirmed' ? 'secondary' : 'outline'}>
          {booking.status === 'confirmed' ? t('seats', { count: booking.seats }) : t('cancelled')}
        </Badge>
        {booking.canCancel && (
          <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        )}
      </CardContent>
    </Card>
  )

  if (!booking.canCancel) {
    return <div>{card}</div>
  }
  return (
    <Link href={`/booking/${booking.manageToken}`} className="group block">
      {card}
    </Link>
  )
}
