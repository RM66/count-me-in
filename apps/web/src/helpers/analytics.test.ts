import type { ServiceCountsRecord } from '@repo/contracts'
import { describe, expect, it } from 'vitest'

import { serviceCountsById, toChartTrend } from '@/helpers/analytics'

describe('serviceCountsById', () => {
  it('keys per-service counts by service id', () => {
    const rows: ServiceCountsRecord[] = [
      { serviceId: 'svc-1', upcomingSlotsCount: 5, confirmedBookingsCount: 12 },
      { serviceId: 'svc-2', upcomingSlotsCount: 0, confirmedBookingsCount: 0 },
    ]
    expect(serviceCountsById(rows)).toEqual({
      'svc-1': { upcomingSlots: 5, confirmedBookings: 12 },
      'svc-2': { upcomingSlots: 0, confirmedBookings: 0 },
    })
  })

  it('returns an empty map for no rows', () => {
    expect(serviceCountsById([])).toEqual({})
  })
})

describe('toChartTrend', () => {
  // Fixed Monday noon UTC: buckets are deterministic regardless of locale.
  const NOW = new Date('2026-08-10T12:00:00Z').getTime()
  const DAY = '2026-08-10'

  it('maps API rows onto the last-7-day window with weekday labels', () => {
    const trend = toChartTrend(
      [
        { day: '2026-08-04', bookings: 2, seats: 5 },
        { day: DAY, bookings: 3, seats: 7 },
      ],
      NOW,
    )
    expect(trend).toHaveLength(7)
    // Oldest bucket (Tue Aug 4) carries its row; labels are UTC weekdays.
    expect(trend[0]).toEqual({ day: 'Tue', bookings: 2, seats: 5 })
    // Newest bucket (Mon Aug 10) carries its row.
    expect(trend[6]).toEqual({ day: 'Mon', bookings: 3, seats: 7 })
  })

  it('zero-fills days with no rows, including a fully empty trend', () => {
    const trend = toChartTrend([], NOW)
    expect(trend).toHaveLength(7)
    expect(trend.every((point) => point.bookings === 0 && point.seats === 0)).toBe(true)
    expect(trend.map((point) => point.day)).toEqual([
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Sun',
      'Mon',
    ])
  })

  it('ignores rows outside the 7-day window without shifting buckets', () => {
    const trend = toChartTrend(
      [
        { day: '2026-07-01', bookings: 99, seats: 99 },
        { day: DAY, bookings: 1, seats: 2 },
      ],
      NOW,
    )
    expect(trend[6]).toEqual({ day: 'Mon', bookings: 1, seats: 2 })
    expect(trend.slice(0, 6).every((point) => point.bookings === 0)).toBe(true)
  })
})
