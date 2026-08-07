'use client'

import type { BookingRecord, ServiceRecord, TimeSlotRecord } from '@repo/api-contracts'
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon, SearchIcon } from 'lucide-react'
import { useState } from 'react'

import { BookingDetailsSheet } from '@/app/cabinet/_components/booking-details-sheet'
import { DAY_MARK, DayFilterChip, DayFilterPicker } from '@/app/cabinet/_components/day-filter'
import { FilterChip } from '@/app/cabinet/_components/filter-chip'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { formatDateTime } from '@/helpers/date'
import { initials } from '@/helpers/name'
import { SORT_KEYS, type SortKey,useBookingsTable } from './use-bookings-table'

type BookingsTableProps = {
  bookings: BookingRecord[]
  /** Slots + services let a row resolve Booking → TimeSlot → Service (docs/domain.md). */
  slots: TimeSlotRecord[]
  services: ServiceRecord[]
  /** Organizer timezone — slot instants are shown as the organizer's local time. */
  timezone: string
  /** Show only this service's bookings. Comes from `?service=` — already validated by the page. */
  activeServiceId?: string
  /** Show only this slot's bookings. Comes from `?slot=` — already validated by the page. */
  activeSlotId?: string
  /** Human name for the active slot ("Service · Tue, Jul 22 · 09:00") for the chip. */
  activeSlotLabel?: string
  /** Read-only demo account (ADR-010). */
  isReadOnly: boolean
}

const HEADER_LABELS: Record<SortKey, string> = {
  guest: 'Guest',
  service: 'Service',
  when: 'When',
  seats: 'Seats',
  status: 'Status',
}

/**
 * The cabinet bookings list: a filterable table plus a details sheet.
 *
 * A client component because filtering and the sheet are interactive, but the
 * **data is passed in** — the page is a server component that reads Postgres
 * directly, the same split the slots and services pages use. The filtering,
 * sorting and scoping logic lives in [`useBookingsTable`](use-bookings-table.ts).
 */
export function BookingsTable({
  bookings,
  slots,
  services,
  timezone,
  activeServiceId,
  activeSlotId,
  activeSlotLabel,
  isReadOnly,
}: BookingsTableProps) {
  const [selected, setSelected] = useState<BookingRecord | null>(null)

  const t = useBookingsTable({
    bookings,
    slots,
    services,
    timezone,
    activeServiceId,
    activeSlotId,
  })

  const sortableHead = (key: SortKey) => {
    const sort = t.sort
    const active = sort?.key === key
    return (
      <TableHead
        key={key}
        aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <Button variant="ghost" size="sm" className="-ml-3 h-8" onClick={() => t.toggleSort(key)}>
          {HEADER_LABELS[key]}
          {active ? (
            sort.dir === 'asc' ? (
              <ArrowUpIcon data-icon="inline-end" />
            ) : (
              <ArrowDownIcon data-icon="inline-end" />
            )
          ) : (
            <ChevronsUpDownIcon data-icon="inline-end" className="opacity-50" />
          )}
        </Button>
      </TableHead>
    )
  }

  const selectedService = selected ? t.serviceOf(selected) : undefined
  const selectedSlot = selected ? t.slotsById.get(selected.timeSlotId) : undefined

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <ToggleGroup
            type="single"
            value={t.filter}
            onValueChange={(v) => v && t.setFilter(v as typeof t.filter)}
            variant="outline"
          >
            <ToggleGroupItem value="all">All</ToggleGroupItem>
            <ToggleGroupItem value="confirmed">Confirmed</ToggleGroupItem>
            <ToggleGroupItem value="cancelled">Cancelled</ToggleGroupItem>
          </ToggleGroup>

          {/*
            These filters are in the URL, so clearing one is a link back to the
            unfiltered page rather than local state — back/forward keep working.
          */}
          {activeSlotLabel ? (
            <FilterChip
              label={activeSlotLabel}
              clearHref="/cabinet/bookings"
              ariaLabel="Show every slot"
            />
          ) : (
            t.activeService && (
              <FilterChip
                label={t.activeService.title}
                clearHref="/cabinet/bookings"
                ariaLabel="Show every service"
              />
            )
          )}

          {t.day && <DayFilterChip dayLabel={t.dayLabel} onClear={() => t.setDay('')} />}
        </div>

        <div className="flex items-center gap-2">
          <DayFilterPicker
            day={t.day}
            dayLabel={t.dayLabel}
            onSelect={t.setDay}
            defaultMonth={t.defaultMonth}
            entityLabel="bookings"
            // The whole point: days whose sessions have bookings are marked.
            modifiers={{ hasBookings: t.bookedDates }}
            modifiersClassNames={{ hasBookings: DAY_MARK.strong.calendarCell }}
            legend={
              <>
                {/* Swatch mirrors the day styling, so the key is self-evident. */}
                <span className={DAY_MARK.strong.legend}>Has bookings</span>
                <span>No bookings — unmarked</span>
              </>
            }
          />

          <div className="relative w-full sm:w-64">
            <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={t.query}
              onChange={(e) => t.setQuery(e.target.value)}
              placeholder="Search guest or service"
              className="pl-9"
            />
          </div>
        </div>
      </div>

      {t.filtered.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchIcon />
            </EmptyMedia>
            <EmptyTitle>No bookings found</EmptyTitle>
            <EmptyDescription>
              {t.scoped.length === 0
                ? activeSlotLabel
                  ? `${activeSlotLabel} has no bookings yet.`
                  : t.activeService
                    ? `${t.activeService.title} has no bookings yet.`
                    : 'Bookings appear here as soon as a guest reserves a seat.'
                : t.day
                  ? `No bookings on ${t.dayLabel}${t.activeService ? ` for ${t.activeService.title}` : ''}.`
                  : 'Try adjusting your filters or search.'}
            </EmptyDescription>
            {t.day && (
              <Button variant="outline" size="sm" onClick={() => t.setDay('')}>
                Show every day
              </Button>
            )}
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>{SORT_KEYS.map(sortableHead)}</TableRow>
            </TableHeader>
            <TableBody>
              {t.rows.map((b) => {
                const svc = t.serviceOf(b)
                const slot = t.slotsById.get(b.timeSlotId)
                return (
                  <TableRow key={b.id} className="cursor-pointer" onClick={() => setSelected(b)}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="size-8">
                          <AvatarFallback>{initials(b.guestName)}</AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col">
                          <span className="font-medium">{b.guestName}</span>
                          <span className="text-xs text-muted-foreground">
                            {b.guestMessengerLogin ?? b.guestMessengerId}
                          </span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{svc?.title}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {slot ? formatDateTime(slot.startsAt, timezone) : '—'}
                    </TableCell>
                    <TableCell>{b.seats}</TableCell>
                    <TableCell>
                      <Badge variant={b.status === 'confirmed' ? 'default' : 'secondary'}>
                        {b.status === 'confirmed' ? 'Confirmed' : 'Cancelled'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <BookingDetailsSheet
        booking={selected}
        service={selectedService}
        slot={selectedSlot}
        timezone={timezone}
        isReadOnly={isReadOnly}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </>
  )
}
