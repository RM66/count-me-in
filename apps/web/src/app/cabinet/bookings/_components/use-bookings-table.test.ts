import type { BookingRecord, ServiceRecord, TimeSlotRecord } from '@repo/contracts'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useBookingsTable } from './use-bookings-table'

// the bookings table's non-rendering half — the transitive join
// (Booking → TimeSlot → Service), the status/search/day filters, the
// slot/service URL scope, and the sort that sinks dangling references.

// ── fixtures ──────────────────────────────────────────────────────────────────

const SLOT_YOGA = '01930000-0000-7000-8000-0000000000a1'
const SLOT_POTTERY = '01930000-0000-7000-8000-0000000000a2'

const slots: TimeSlotRecord[] = [
  {
    id: '01930000-0000-7000-8000-0000000000a1',
    serviceId: 'svc-yoga',
    startsAt: '2026-07-20T05:00:00.000Z', // Monday in Belgrade
    durationMinutes: 60,
    capacity: 10,
    bookedCount: 3,
    price: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: '01930000-0000-7000-8000-0000000000a2',
    serviceId: 'svc-pottery',
    startsAt: '2026-07-21T17:00:00.000Z', // Tuesday in Belgrade
    durationMinutes: 90,
    capacity: 8,
    bookedCount: 1,
    price: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
] as unknown as TimeSlotRecord[]

const services: ServiceRecord[] = [
  {
    id: 'svc-yoga',
    organizerId: '01930000-0000-7000-8000-0000000000a9',
    title: 'Morning Yoga',
    description: null,
    photoUrl: null,
    location: null,
    contact: null,
    defaultPrice: '15 EUR',
    defaultCapacity: 10,
    defaultDurationMinutes: 60,
    maxSeatsPerBooking: 4,
    options: null,
    optionsSelectMode: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'svc-pottery',
    organizerId: '01930000-0000-7000-8000-0000000000a9',
    title: 'Pottery Basics',
    description: null,
    photoUrl: null,
    location: null,
    contact: null,
    defaultPrice: '20 EUR',
    defaultCapacity: 8,
    defaultDurationMinutes: 90,
    maxSeatsPerBooking: 1,
    options: null,
    optionsSelectMode: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
] as unknown as ServiceRecord[]

function booking(overrides: Partial<BookingRecord>): BookingRecord {
  return {
    id: '01930000-0000-7000-8000-0000000000b1',
    timeSlotId: SLOT_YOGA,
    status: 'confirmed',
    seats: 2,
    guestName: 'Ann Smith',
    guestMessenger: 'telegram',
    guestMessengerId: '60001',
    guestMessengerLogin: 'annsmith',
    selectedOptions: null,
    createdAt: '2026-07-01T10:00:00.000Z',
    ...overrides,
  } as BookingRecord
}

const bookings: BookingRecord[] = [
  booking({ id: 'b1', guestName: 'Ann Smith', guestMessengerLogin: 'annsmith' }),
  booking({
    id: 'b2',
    timeSlotId: SLOT_POTTERY,
    status: 'cancelled',
    guestName: 'Bob Jones',
    guestMessengerId: '60002',
    guestMessengerLogin: null,
  }),
  // A booking whose slot is gone (deleted service) — must not crash and
  // must sink to the end when sorting.
  booking({
    id: 'b3',
    timeSlotId: '01930000-0000-7000-8000-0000000000ff',
    guestName: 'Zoe Void',
    guestMessengerId: '60003',
    guestMessengerLogin: null,
  }),
]

function renderTable(overrides: Partial<Parameters<typeof useBookingsTable>[0]> = {}) {
  return renderHook(() =>
    useBookingsTable({
      bookings,
      slots,
      services,
      timezone: 'Europe/Belgrade',
      ...overrides,
    }),
  )
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('useBookingsTable — scope', () => {
  it('scopes to one slot when activeSlotId is set (the narrower filter)', () => {
    const { result } = renderTable({ activeSlotId: SLOT_YOGA })
    expect(result.current.scoped.map((b) => b.id)).toEqual(['b1'])
  })

  it('scopes to a service via the transitive slot join', () => {
    const { result } = renderTable({ activeServiceId: 'svc-pottery' })
    expect(result.current.scoped.map((b) => b.id)).toEqual(['b2'])
  })

  it('shows everything without URL scope', () => {
    const { result } = renderTable()
    expect(result.current.scoped).toHaveLength(3)
  })
})

describe('useBookingsTable — filters', () => {
  it('filters by status', () => {
    const { result } = renderTable()
    act(() => result.current.setFilter('cancelled'))
    expect(result.current.rows.map((b) => b.id)).toEqual(['b2'])
  })

  it('searches across guest name, login, messenger id and service title', () => {
    const { result } = renderTable()

    act(() => result.current.setQuery('bob'))
    expect(result.current.rows.map((b) => b.id)).toEqual(['b2'])

    act(() => result.current.setQuery('annsmith'))
    expect(result.current.rows.map((b) => b.id)).toEqual(['b1'])

    act(() => result.current.setQuery('60001'))
    expect(result.current.rows.map((b) => b.id)).toEqual(['b1'])

    act(() => result.current.setQuery('pottery'))
    expect(result.current.rows.map((b) => b.id)).toEqual(['b2'])
  })

  it('search is case-insensitive and trims the needle', () => {
    const { result } = renderTable()
    act(() => result.current.setQuery('  ANN SMITH '))
    expect(result.current.rows.map((b) => b.id)).toEqual(['b1'])
  })

  it('an empty result is just empty — no crash on dangling joins', () => {
    const { result } = renderTable({ activeSlotId: SLOT_POTTERY })
    act(() => result.current.setQuery('ann'))
    expect(result.current.rows).toEqual([])
  })
})

describe('useBookingsTable — sorting', () => {
  it('null sort keeps the server order (newest first)', () => {
    const { result } = renderTable()
    expect(result.current.sort).toBeNull()
    expect(result.current.rows.map((b) => b.id)).toEqual(['b1', 'b2', 'b3'])
  })

  it('sorts by guest name ascending', () => {
    const { result } = renderTable()
    act(() => result.current.toggleSort('guest'))
    expect(result.current.rows.map((b) => b.guestName)).toEqual([
      'Ann Smith',
      'Bob Jones',
      'Zoe Void',
    ])
  })

  it('cycles a column: asc → desc → unsorted', () => {
    const { result } = renderTable()
    act(() => result.current.toggleSort('seats'))
    expect(result.current.sort).toEqual({ key: 'seats', dir: 'asc' })
    act(() => result.current.toggleSort('seats'))
    expect(result.current.sort).toEqual({ key: 'seats', dir: 'desc' })
    act(() => result.current.toggleSort('seats'))
    expect(result.current.sort).toBeNull()
  })

  it('a booking whose slot is gone always sinks to the end', () => {
    const { result } = renderTable()
    act(() => result.current.toggleSort('when'))
    // Ascending by start time: the dangling b3 must be last even though
    // its sort value is null (not "smallest").
    expect(result.current.rows.map((b) => b.id)).toEqual(['b1', 'b2', 'b3'])
    act(() => result.current.toggleSort('when')) // desc
    expect(result.current.rows.map((b) => b.id)).toEqual(['b2', 'b1', 'b3'])
  })
})

describe('useBookingsTable — day marks', () => {
  it('marks the calendar days of the scoped bookings', () => {
    const { result } = renderTable()
    // Two distinct Belgrade days: Mon 2026-07-20 and Tue 2026-07-21.
    expect(result.current.bookedDates).toHaveLength(2)
  })

  it('a booking with a dangling slot contributes no day mark', () => {
    const { result } = renderTable({ activeSlotId: '01930000-0000-7000-8000-0000000000ff' })
    expect(result.current.bookedDates).toHaveLength(0)
  })
})
