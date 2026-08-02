'use client'

import type { BookingRecord, ServiceRecord, TimeSlotRecord } from '@repo/api-contracts'
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon, SearchIcon, XIcon } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

import { BookingDetailsSheet } from '@/app/cabinet/_components/booking-details-sheet'
import {
  DAY_MARK,
  DayFilterChip,
  DayFilterPicker,
  dayKeyToDate,
  useDayFilter,
} from '@/app/cabinet/_components/day-filter'
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
import { formatDateTime } from '@/lib/helpers/date'
import { initials } from '@/lib/helpers/name'

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

const SORT_KEYS = ['guest', 'service', 'when', 'seats', 'status'] as const
type SortKey = (typeof SORT_KEYS)[number]

/** Active column sort, or `null` for the server's default order (newest first). */
type SortState = { key: SortKey; dir: 'asc' | 'desc' } | null

/**
 * The cabinet bookings list: a filterable table plus a details sheet.
 *
 * A client component because filtering and the sheet are interactive, but the
 * **data is passed in** — the page is a server component that reads Postgres
 * directly, the same split the slots and services pages use.
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
  const [filter, setFilter] = useState<'all' | 'confirmed' | 'cancelled'>('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<BookingRecord | null>(null)
  const [sort, setSort] = useState<SortState>(null)
  // Day key, label and timezone-correct day grouping — shared with the slots
  // table via `_components/day-filter`.
  const { day, setDay, dayLabel, dayKeyOf } = useDayFilter(timezone)

  // A booking reaches its service transitively (Booking → TimeSlot → Service)
  // — there is no Booking.serviceId column, so the join happens here.
  const slotsById = new Map(slots.map((slot) => [slot.id, slot]))
  const servicesById = new Map(services.map((service) => [service.id, service]))

  const serviceOf = (booking: BookingRecord): ServiceRecord | undefined => {
    const slot = slotsById.get(booking.timeSlotId)
    return slot ? servicesById.get(slot.serviceId) : undefined
  }

  const activeService = activeServiceId ? servicesById.get(activeServiceId) : undefined

  /**
   * The calendar day a booking's session falls on, via its slot. `null` when
   * the slot is gone — such a booking never matches a day filter.
   */
  const bookingDayOf = (booking: BookingRecord): string | null => {
    const slot = slotsById.get(booking.timeSlotId)
    return slot ? dayKeyOf(slot.startsAt) : null
  }

  // URL scope first: a slot filter pins one session (the narrower filter), a
  // service filter follows the booking's slot to its serviceId — there is no
  // Booking.serviceId. The calendar's marks follow this scope, so while
  // filtered the picker answers "when is *this* booked".
  const scoped = activeSlotId
    ? bookings.filter((b) => b.timeSlotId === activeSlotId)
    : activeServiceId
      ? bookings.filter((b) => slotsById.get(b.timeSlotId)?.serviceId === activeServiceId)
      : bookings

  const filtered = scoped.filter((b) => {
    const matchesFilter = filter === 'all' || b.status === filter
    const matchesDay = day === '' || bookingDayOf(b) === day
    const needle = query.trim().toLowerCase()
    const matchesQuery =
      needle === '' ||
      b.guestName.toLowerCase().includes(needle) ||
      (b.guestMessengerLogin ?? '').toLowerCase().includes(needle) ||
      b.guestMessengerId.toLowerCase().includes(needle) ||
      (serviceOf(b)?.title ?? '').toLowerCase().includes(needle)
    return matchesFilter && matchesDay && matchesQuery
  })

  /**
   * Which days to mark in the picker — the reason it exists rather than the
   * native control, which cannot say anything about a day's contents. A day is
   * marked when at least one scoped booking's session falls on it.
   */
  const bookedKeys = [
    ...new Set(scoped.map(bookingDayOf).filter((key): key is string => key !== null)),
  ]
  const bookedDates = bookedKeys.map(dayKeyToDate)

  /**
   * Which month to open on: the next booked session, else the most recent one,
   * else today. (A selected day wins — the picker handles that itself.) The
   * popover mounts only after a click, so reading the client clock here cannot
   * cause a hydration mismatch.
   */
  const sortedBookedDates = [...bookedDates].sort((a, b) => a.getTime() - b.getTime())
  const nextBooked = sortedBookedDates.find((date) => date.getTime() >= Date.now())
  const defaultMonth = nextBooked ?? sortedBookedDates.at(-1) ?? new Date()

  /**
   * The comparable value behind each column. "When" and "Service" sort by the
   * *joined* slot/service, and a booking whose slot is gone (deleted service)
   * yields `null` — those rows always sink to the end, whatever the direction,
   * so a dangling reference cannot masquerade as the earliest session.
   */
  const sortValue = (booking: BookingRecord, key: SortKey): string | number | null => {
    switch (key) {
      case 'guest':
        return booking.guestName.toLowerCase()
      case 'service':
        return serviceOf(booking)?.title.toLowerCase() ?? null
      case 'when':
        // ISO 8601 instants compare correctly as strings.
        return slotsById.get(booking.timeSlotId)?.startsAt ?? null
      case 'seats':
        return booking.seats
      case 'status':
        return booking.status
    }
  }

  // `null` sort keeps the server order (newest booking first).
  const rows = sort
    ? [...filtered].sort((a, b) => {
        const left = sortValue(a, sort.key)
        const right = sortValue(b, sort.key)
        if (left === right) return 0
        if (left === null) return 1
        if (right === null) return -1
        const cmp = left < right ? -1 : 1
        return sort.dir === 'asc' ? cmp : -cmp
      })
    : filtered

  /** Cycle a column: unsorted → ascending → descending → unsorted. */
  const toggleSort = (key: SortKey) => {
    setSort((current) => {
      if (current?.key !== key) return { key, dir: 'asc' }
      if (current.dir === 'asc') return { key, dir: 'desc' }
      return null
    })
  }

  const HEADER_LABELS: Record<SortKey, string> = {
    guest: 'Guest',
    service: 'Service',
    when: 'When',
    seats: 'Seats',
    status: 'Status',
  }

  const sortableHead = (key: SortKey) => {
    const active = sort?.key === key
    return (
      <TableHead
        key={key}
        aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <Button variant="ghost" size="sm" className="-ml-3 h-8" onClick={() => toggleSort(key)}>
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

  const selectedService = selected ? serviceOf(selected) : undefined
  const selectedSlot = selected ? slotsById.get(selected.timeSlotId) : undefined

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <ToggleGroup
            type="single"
            value={filter}
            onValueChange={(v) => v && setFilter(v as typeof filter)}
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
            <Badge variant="secondary" className="gap-1 py-1 pr-1 pl-2.5 h-6 text-sm text-primary">
              {activeSlotLabel}
              <Button variant="ghost" size="icon" className="size-5 hover:bg-transparent" asChild>
                <Link href="/cabinet/bookings" aria-label="Show every slot">
                  <XIcon className="size-3.5" />
                </Link>
              </Button>
            </Badge>
          ) : (
            activeService && (
              <Badge
                variant="secondary"
                className="gap-1 py-1 pr-1 pl-2.5 h-6 text-sm text-primary"
              >
                {activeService.title}
                <Button variant="ghost" size="icon" className="size-5 hover:bg-transparent" asChild>
                  <Link href="/cabinet/bookings" aria-label="Show every service">
                    <XIcon className="size-3.5" />
                  </Link>
                </Button>
              </Badge>
            )
          )}

          {day && <DayFilterChip dayLabel={dayLabel} onClear={() => setDay('')} />}
        </div>

        <div className="flex items-center gap-2">
          <DayFilterPicker
            day={day}
            dayLabel={dayLabel}
            onSelect={setDay}
            defaultMonth={defaultMonth}
            entityLabel="bookings"
            // The whole point: days whose sessions have bookings are marked.
            modifiers={{ hasBookings: bookedDates }}
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
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search guest or service"
              className="pl-9"
            />
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchIcon />
            </EmptyMedia>
            <EmptyTitle>No bookings found</EmptyTitle>
            <EmptyDescription>
              {scoped.length === 0
                ? activeSlotLabel
                  ? `${activeSlotLabel} has no bookings yet.`
                  : activeService
                    ? `${activeService.title} has no bookings yet.`
                    : 'Bookings appear here as soon as a guest reserves a seat.'
                : day
                  ? `No bookings on ${dayLabel}${activeService ? ` for ${activeService.title}` : ''}.`
                  : 'Try adjusting your filters or search.'}
            </EmptyDescription>
            {day && (
              <Button variant="outline" size="sm" onClick={() => setDay('')}>
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
              {rows.map((b) => {
                const svc = serviceOf(b)
                const slot = slotsById.get(b.timeSlotId)
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
