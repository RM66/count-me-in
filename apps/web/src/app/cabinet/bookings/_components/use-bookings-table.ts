'use client'

import type { BookingRecord, ServiceRecord, TimeSlotRecord } from '@repo/contracts'
import { useState } from 'react'

import { useDayFilter } from '@/app/cabinet/_components/day-filter'
import { dayKeyToDate } from '@/app/cabinet/_components/day-filter'

const SORT_KEYS = ['guest', 'service', 'when', 'seats', 'status'] as const
export type SortKey = (typeof SORT_KEYS)[number]

/** Active column sort, or `null` for the server's default order (newest first). */
export type SortState = { key: SortKey; dir: 'asc' | 'desc' } | null

export { SORT_KEYS }

type UseBookingsTableOptions = {
  bookings: BookingRecord[]
  slots: TimeSlotRecord[]
  services: ServiceRecord[]
  timezone: string
  activeServiceId?: string
  activeSlotId?: string
}

/**
 * The filtering, scoping, sorting and day-marking logic behind the bookings
 * table — everything that is *not* rendering.
 *
 * Extracted from [`BookingsTable`](bookings-table.tsx) so the component is left
 * with the table markup and this hook can be tested in isolation.
 *
 * A booking reaches its service transitively (Booking → TimeSlot → Service) —
 * there is no `Booking.serviceId` column, so the join happens here.
 */
export function useBookingsTable({
  bookings,
  slots,
  services,
  timezone,
  activeServiceId,
  activeSlotId,
}: UseBookingsTableOptions) {
  const [filter, setFilter] = useState<'all' | 'confirmed' | 'cancelled'>('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortState>(null)
  const { day, setDay, dayLabel, dayKeyOf } = useDayFilter(timezone)

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

  return {
    filter,
    setFilter,
    query,
    setQuery,
    sort,
    toggleSort,
    day,
    setDay,
    dayLabel,
    scoped,
    filtered,
    rows,
    bookedDates,
    defaultMonth,
    slotsById,
    servicesById,
    serviceOf,
    activeService,
  }
}
