'use client'

import type { BookingRecord, ServiceRecord, TimeSlotRecord } from '@repo/contracts'
import { useLocale, useTranslations } from 'next-intl'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { TableCell, TableRow } from '@/components/ui/table'
import { formatDateTime } from '@/helpers/date'
import { initials } from '@/helpers/name'

type BookingRowProps = {
  booking: BookingRecord
  /** Resolved through the row's slot — absent if the service was deleted. */
  service?: ServiceRecord
  /** The booking's session — embedded by the bookings endpoint. */
  slot?: TimeSlotRecord
  /** Organizer timezone — slot instants are shown as the organizer's local time. */
  timezone: string
  onSelect: (booking: BookingRecord) => void
}

/** One bookings row: guest identity, service, session time, seats, status. */
export function BookingRow({ booking, service, slot, timezone, onSelect }: BookingRowProps) {
  const tc = useTranslations('Cabinet.common')
  const locale = useLocale()

  return (
    <TableRow className="cursor-pointer" onClick={() => onSelect(booking)}>
      <TableCell>
        <div className="flex items-center gap-3">
          <Avatar className="size-8">
            <AvatarFallback>{initials(booking.guestName)}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col">
            <span className="font-medium">{booking.guestName}</span>
            <span className="text-xs text-muted-foreground">
              {booking.guestMessengerLogin ?? booking.guestMessengerId}
            </span>
          </div>
        </div>
      </TableCell>
      <TableCell>{service?.title}</TableCell>
      <TableCell className="text-muted-foreground">
        {slot ? formatDateTime(slot.startsAt, timezone, locale) : '—'}
      </TableCell>
      <TableCell>{booking.seats}</TableCell>
      <TableCell>
        <Badge variant={booking.status === 'confirmed' ? 'default' : 'secondary'}>
          {booking.status === 'confirmed' ? tc('confirmed') : tc('cancelled')}
        </Badge>
      </TableCell>
    </TableRow>
  )
}
