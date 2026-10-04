'use client'

import type { ServiceRecord, SlotFill, TimeSlotRecord } from '@repo/contracts'
import { fillLabel, seatsLeft, slotPrice } from '@repo/contracts'
import { MoreHorizontalIcon } from 'lucide-react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Progress } from '@/components/ui/progress'
import { TableCell, TableRow } from '@/components/ui/table'
import { formatDate, formatTime } from '@/helpers/date'

type SlotRowProps = {
  slot: TimeSlotRecord
  /** The slot's service, looked up by the table — absent if it was deleted. */
  service?: ServiceRecord
  /** Organizer timezone — slots are stored as instants, shown as local time. */
  timezone: string
  /** Read-only demo account (ADR-010). */
  isReadOnly: boolean
  onEdit: (slot: TimeSlotRecord) => void
  onDuplicate: (slot: TimeSlotRecord) => void
  onDelete: (slot: TimeSlotRecord) => void
}

/** One schedule row: service, when, seat gauge, price, fill badge, and the actions menu. */
export function SlotRow({
  slot,
  service,
  timezone,
  isReadOnly,
  onEdit,
  onDuplicate,
  onDelete,
}: SlotRowProps) {
  const t = useTranslations('Cabinet.slots')
  const tc = useTranslations('Cabinet.common')
  const locale = useLocale()

  const FILL_BADGE: Record<
    SlotFill,
    { label: string; variant: 'secondary' | 'outline' | 'default' }
  > = {
    open: { label: t('open'), variant: 'outline' },
    filling: { label: t('fillingUp'), variant: 'default' },
    full: { label: t('full'), variant: 'secondary' },
  }

  const left = seatsLeft(slot)
  const pct = Math.round((slot.bookedCount / slot.capacity) * 100)
  const fill = FILL_BADGE[fillLabel(slot)]

  return (
    <TableRow>
      <TableCell className="font-medium">{service?.title}</TableCell>
      <TableCell className="text-muted-foreground">
        <div className="flex flex-col">
          <span>{formatDate(slot.startsAt, timezone, locale)}</span>
          <span className="text-xs">
            {formatTime(slot.startsAt, timezone, locale)} ·{' '}
            {tc('min', { minutes: slot.durationMinutes })}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex w-32 flex-col gap-1">
          <span className="text-xs text-muted-foreground">
            {slot.bookedCount}/{slot.capacity} · {t('left', { count: left })}
          </span>
          <Progress value={pct} />
        </div>
      </TableCell>
      <TableCell>{slotPrice(slot, service)}</TableCell>
      <TableCell>
        <Badge variant={fill.variant}>{fill.label}</Badge>
      </TableCell>
      <TableCell>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8">
              <MoreHorizontalIcon />
              <span className="sr-only">{t('slotActions')}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem disabled={isReadOnly} onSelect={() => onEdit(slot)}>
                {t('editSlot')}
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                {/* Deep link into the bookings page filtered to this session. */}
                <Link href={`/cabinet/bookings?slot=${slot.id}`}>{t('viewBookings')}</Link>
              </DropdownMenuItem>
              <DropdownMenuItem disabled={isReadOnly} onSelect={() => onDuplicate(slot)}>
                {t('duplicate')}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                // hasBookings covers cancelled rows that bookedCount (seats)
                // cannot see — the API refuses deletion for either (409).
                disabled={isReadOnly || slot.bookedCount > 0 || slot.hasBookings === true}
                onSelect={() => onDelete(slot)}
              >
                {t('deleteSlot')}
              </DropdownMenuItem>
              {(slot.bookedCount > 0 || slot.hasBookings === true) && (
                <DropdownMenuLabel className="whitespace-normal">
                  {t('deleteBlocked')}
                </DropdownMenuLabel>
              )}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  )
}
