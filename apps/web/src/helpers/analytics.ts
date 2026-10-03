import type { ServiceCountsRecord } from '@repo/contracts'

/** One point on the per-day trend chart. */
export interface AnalyticsTrendPoint {
  /** Weekday label, e.g. "Mon". */
  day: string
  /** Confirmed bookings created that day. */
  bookings: number
  /** Seats from confirmed bookings created that day. */
  seats: number
}

/** One bar on the per-service breakdown chart. */
export interface AnalyticsServicePoint {
  /** Service title. */
  service: string
  /** Confirmed bookings in the window. */
  bookings: number
}

/**
 * Zero-fill a 14-day API trend (YYYY-MM-DD keys) into the 7-day chart
 * buckets the analytics page plots, with weekday labels.
 */
export function toChartTrend(
  trend: Array<{ day: string; bookings: number; seats: number }>,
  nowMs: number = Date.now(),
): AnalyticsTrendPoint[] {
  const byDay = new Map(trend.map((row) => [row.day, row]))
  const DAY_MS = 24 * 60 * 60 * 1000
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(nowMs - (6 - i) * DAY_MS)
    const key = date.toISOString().slice(0, 10)
    const row = byDay.get(key)
    return {
      day: date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
      bookings: row?.bookings ?? 0,
      seats: row?.seats ?? 0,
    }
  })
}

/** Per-service counts keyed by service id, for the services list. */
export function serviceCountsById(
  serviceCounts: ServiceCountsRecord[],
): Record<string, { upcomingSlots: number; confirmedBookings: number }> {
  return Object.fromEntries(
    serviceCounts.map((row) => [
      row.serviceId,
      { upcomingSlots: row.upcomingSlotsCount, confirmedBookings: row.confirmedBookingsCount },
    ]),
  )
}
