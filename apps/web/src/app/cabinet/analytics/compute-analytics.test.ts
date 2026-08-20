import type { BookingRecord, ServiceRecord, TimeSlotRecord } from '@repo/contracts'
import { describe, expect, it } from 'vitest'

import { computeAnalytics } from './compute-analytics'

const DAY = 24 * 60 * 60 * 1000

/** Fixed `now` so window boundaries are deterministic. */
const NOW = new Date('2026-08-11T12:00:00Z').getTime()

function slot(
  id: string,
  serviceId: string,
  startsAt: string,
  capacity: number,
  bookedCount: number,
): TimeSlotRecord {
  return {
    id,
    serviceId,
    startsAt,
    durationMinutes: 60,
    capacity,
    bookedCount,
    price: null,
    createdAt: startsAt,
  }
}

function booking(
  id: string,
  timeSlotId: string,
  status: 'confirmed' | 'cancelled',
  seats: number,
  createdAtDaysAgo: number,
): BookingRecord {
  return {
    id,
    timeSlotId,
    status,
    seats,
    guestName: 'Guest',
    guestMessenger: 'telegram',
    guestMessengerId: `guest-${id}`,
    guestMessengerLogin: null,
    selectedOptions: null,
    createdAt: new Date(NOW - createdAtDaysAgo * DAY).toISOString(),
  }
}

function service(id: string, title: string): ServiceRecord {
  return {
    id,
    organizerId: 'org-1',
    title,
    description: null,
    photoUrl: null,
    location: null,
    contact: null,
    defaultPrice: '$10',
    defaultCapacity: 10,
    defaultDurationMinutes: 60,
    maxSeatsPerBooking: 2,
    options: null,
    optionsSelectMode: null,
    createdAt: new Date(NOW - 60 * DAY).toISOString(),
  }
}

describe('computeAnalytics', () => {
  it('counts confirmed bookings and seats in the 30-day window', () => {
    const services = [service('s1', 'Yoga')]
    const slots = [slot('sl1', 's1', new Date(NOW + DAY).toISOString(), 10, 5)]
    const bookings = [
      booking('b1', 'sl1', 'confirmed', 2, 1),
      booking('b2', 'sl1', 'confirmed', 3, 10),
      booking('b3', 'sl1', 'cancelled', 1, 2),
    ]

    const summary = computeAnalytics(bookings, slots, services, NOW)

    expect(summary.totalBookings).toBe(2)
    expect(summary.seatsSold).toBe(5)
  })

  it('excludes bookings older than 30 days from the window', () => {
    const services = [service('s1', 'Yoga')]
    const slots = [slot('sl1', 's1', new Date(NOW + DAY).toISOString(), 10, 0)]
    const bookings = [
      booking('b1', 'sl1', 'confirmed', 2, 5),
      booking('b2', 'sl1', 'confirmed', 2, 31),
    ]

    const summary = computeAnalytics(bookings, slots, services, NOW)

    expect(summary.totalBookings).toBe(1)
    expect(summary.seatsSold).toBe(2)
  })

  it('computes a period-over-period delta', () => {
    const services = [service('s1', 'Yoga')]
    const slots = [slot('sl1', 's1', new Date(NOW + DAY).toISOString(), 10, 0)]
    // Current window: 4 confirmed. Previous window: 2 confirmed → +100%.
    const bookings = [
      booking('b1', 'sl1', 'confirmed', 1, 1),
      booking('b2', 'sl1', 'confirmed', 1, 2),
      booking('b3', 'sl1', 'confirmed', 1, 3),
      booking('b4', 'sl1', 'confirmed', 1, 4),
      booking('b5', 'sl1', 'confirmed', 1, 35),
      booking('b6', 'sl1', 'confirmed', 1, 40),
    ]

    const summary = computeAnalytics(bookings, slots, services, NOW)

    expect(summary.totalBookings).toBe(4)
    expect(summary.totalBookingsDelta).toBe(1)
  })

  it('returns null delta when the previous window is empty', () => {
    const services = [service('s1', 'Yoga')]
    const slots = [slot('sl1', 's1', new Date(NOW + DAY).toISOString(), 10, 0)]
    const bookings = [booking('b1', 'sl1', 'confirmed', 1, 1)]

    const summary = computeAnalytics(bookings, slots, services, NOW)

    expect(summary.totalBookingsDelta).toBeNull()
  })

  it('computes fill rate from upcoming slot bookedCount', () => {
    const services = [service('s1', 'Yoga')]
    const slots = [
      slot('sl1', 's1', new Date(NOW + DAY).toISOString(), 10, 5),
      slot('sl2', 's1', new Date(NOW + 2 * DAY).toISOString(), 10, 3),
    ]
    const bookings: BookingRecord[] = []

    const summary = computeAnalytics(bookings, slots, services, NOW)

    // (5 + 3) / (10 + 10) = 40%
    expect(summary.fillRate).toBe(40)
    expect(summary.upcomingSlots).toBe(2)
  })

  it('returns null fill rate when there is no upcoming capacity', () => {
    const services = [service('s1', 'Yoga')]
    const slots = [slot('sl1', 's1', new Date(NOW - DAY).toISOString(), 10, 5)]
    const bookings: BookingRecord[] = []

    const summary = computeAnalytics(bookings, slots, services, NOW)

    expect(summary.fillRate).toBeNull()
    expect(summary.upcomingSlots).toBe(0)
  })

  it('computes cancellation rate over all bookings in the window', () => {
    const services = [service('s1', 'Yoga')]
    const slots = [slot('sl1', 's1', new Date(NOW + DAY).toISOString(), 10, 0)]
    const bookings = [
      booking('b1', 'sl1', 'confirmed', 1, 1),
      booking('b2', 'sl1', 'confirmed', 1, 2),
      booking('b3', 'sl1', 'cancelled', 1, 3),
      booking('b4', 'sl1', 'cancelled', 1, 4),
    ]

    const summary = computeAnalytics(bookings, slots, services, NOW)

    // 2 cancelled of 4 total = 50%
    expect(summary.cancellationRate).toBe(50)
    expect(summary.windowBookings).toBe(4)
  })

  it('returns null cancellation rate when the window is empty', () => {
    const services = [service('s1', 'Yoga')]
    const slots = [slot('sl1', 's1', new Date(NOW + DAY).toISOString(), 10, 0)]
    const bookings = [booking('b1', 'sl1', 'confirmed', 1, 40)]

    const summary = computeAnalytics(bookings, slots, services, NOW)

    expect(summary.cancellationRate).toBeNull()
    expect(summary.windowBookings).toBe(0)
  })

  it('builds a 7-day trend of confirmed bookings', () => {
    const services = [service('s1', 'Yoga')]
    const slots = [slot('sl1', 's1', new Date(NOW + DAY).toISOString(), 10, 0)]
    const bookings = [
      booking('b1', 'sl1', 'confirmed', 2, 0),
      booking('b2', 'sl1', 'confirmed', 1, 0),
      booking('b3', 'sl1', 'confirmed', 3, 3),
    ]

    const summary = computeAnalytics(bookings, slots, services, NOW)

    expect(summary.trend).toHaveLength(7)
    // Today (0 days ago): 2 bookings, 3 seats.
    expect(summary.trend.at(-1)?.bookings).toBe(2)
    expect(summary.trend.at(-1)?.seats).toBe(3)
    // 3 days ago: 1 booking, 3 seats.
    const threeDaysAgo = summary.trend.at(-4)
    expect(threeDaysAgo?.bookings).toBe(1)
    expect(threeDaysAgo?.seats).toBe(3)
  })

  it('groups confirmed bookings by service through the slot', () => {
    const services = [service('s1', 'Yoga'), service('s2', 'Pottery')]
    const slots = [
      slot('sl1', 's1', new Date(NOW + DAY).toISOString(), 10, 0),
      slot('sl2', 's2', new Date(NOW + 2 * DAY).toISOString(), 8, 0),
    ]
    const bookings = [
      booking('b1', 'sl1', 'confirmed', 1, 1),
      booking('b2', 'sl1', 'confirmed', 1, 2),
      booking('b3', 'sl2', 'confirmed', 1, 3),
    ]

    const summary = computeAnalytics(bookings, slots, services, NOW)

    expect(summary.byService).toEqual([
      { service: 'Yoga', bookings: 2 },
      { service: 'Pottery', bookings: 1 },
    ])
  })

  it('omits services with no bookings in the window from the breakdown', () => {
    const services = [service('s1', 'Yoga'), service('s2', 'Pottery')]
    const slots = [
      slot('sl1', 's1', new Date(NOW + DAY).toISOString(), 10, 0),
      slot('sl2', 's2', new Date(NOW + 2 * DAY).toISOString(), 8, 0),
    ]
    const bookings = [booking('b1', 'sl1', 'confirmed', 1, 1)]

    const summary = computeAnalytics(bookings, slots, services, NOW)

    expect(summary.byService).toEqual([{ service: 'Yoga', bookings: 1 }])
  })

  it('ignores bookings whose slot has been deleted', () => {
    const services = [service('s1', 'Yoga')]
    const slots = [slot('sl1', 's1', new Date(NOW + DAY).toISOString(), 10, 0)]
    const bookings = [
      booking('b1', 'sl1', 'confirmed', 1, 1),
      booking('b2', 'deleted-slot', 'confirmed', 1, 2),
    ]

    const summary = computeAnalytics(bookings, slots, services, NOW)

    // b2's slot is gone, so it counts toward totalBookings but not byService.
    expect(summary.totalBookings).toBe(2)
    expect(summary.byService).toEqual([{ service: 'Yoga', bookings: 1 }])
  })

  it('handles an empty organizer', () => {
    const summary = computeAnalytics([], [], [], NOW)

    expect(summary.totalBookings).toBe(0)
    expect(summary.seatsSold).toBe(0)
    expect(summary.fillRate).toBeNull()
    expect(summary.cancellationRate).toBeNull()
    expect(summary.trend).toHaveLength(7)
    expect(summary.byService).toEqual([])
  })
})
