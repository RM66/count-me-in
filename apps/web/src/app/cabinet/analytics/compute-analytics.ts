import type { BookingRecord, ServiceRecord, TimeSlotRecord } from '@repo/contracts'
import { fillRate } from '@repo/contracts'

const DAY_MS = 24 * 60 * 60 * 1000

/** Rolling window for headline metrics and the per-service breakdown. */
const WINDOW_DAYS = 30

/** Number of days plotted in the trend chart. */
const TREND_DAYS = 7

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
 * The analytics summary the cabinet page renders. Every field is a primitive
 * so the shape can cross the server→client component boundary without custom
 * serialization.
 */
export interface AnalyticsSummary {
  /** Confirmed bookings created in the last 30 days. */
  totalBookings: number
  /**
   * Period-over-period change in total bookings, as a fraction
   * (e.g. `0.18` for +18%), or `null` when the previous window had none — a
   * division by zero is undefined, not zero. The caller formats it.
   */
  totalBookingsDelta: number | null
  /** Seats from confirmed bookings created in the last 30 days. */
  seatsSold: number
  /** Period-over-period change in seats sold, or `null` (see above). */
  seatsSoldDelta: number | null
  /**
   * Fill rate across upcoming slots, or `null` when there is no upcoming
   * capacity — "0%" would read as an empty room rather than an empty calendar.
   */
  fillRate: number | null
  /** Cancellation rate in the last 30 days, or `null` when there are no
   * bookings at all in the window. */
  cancellationRate: number | null
  /** Total bookings (any status) in the last 30 days — the denominator behind
   * `cancellationRate`, shown as a hint. */
  windowBookings: number
  /** Number of upcoming slots the fill rate is averaged across. */
  upcomingSlots: number
  /** Per-day confirmed bookings/seats for the trend chart. */
  trend: AnalyticsTrendPoint[]
  /** Per-service confirmed bookings for the breakdown chart. */
  byService: AnalyticsServicePoint[]
}

/** Percentage change from `prev` to `curr`, or `null` when `prev` is zero. */
function percentDelta(curr: number, prev: number): number | null {
  if (prev === 0) return null
  return (curr - prev) / prev
}

/**
 * Aggregate an organizer's bookings, slots and services into the cabinet
 * analytics summary. All time windows are rolling (relative to `now`) so the
 * page stays correct at any hour of any day — there is no "this week" that
 * resets on a server timezone boundary.
 *
 * **Fill rate uses `bookedCount`**, the column the atomic reserve maintains
 * (invariant 2 in docs/domain.md), not a sum of booking seats — the two drift
 * apart the moment a cancellation releases a seat. This matches the cabinet
 * overview page.
 *
 * A booking reaches its service transitively (Booking → TimeSlot → Service);
 * there is no `Booking.serviceId` column, so the per-service breakdown joins
 * through the slot here.
 */
export function computeAnalytics(
  bookings: BookingRecord[],
  slots: TimeSlotRecord[],
  services: ServiceRecord[],
  now: number = Date.now(),
): AnalyticsSummary {
  const slotsById = new Map(slots.map((slot) => [slot.id, slot]))
  const servicesById = new Map(services.map((service) => [service.id, service]))

  const windowStart = now - WINDOW_DAYS * DAY_MS
  const prevWindowStart = now - 2 * WINDOW_DAYS * DAY_MS

  const created = (b: BookingRecord) => new Date(b.createdAt).getTime()
  const inWindow = (b: BookingRecord) => created(b) >= windowStart
  const inPrevWindow = (b: BookingRecord) => {
    const t = created(b)
    return t >= prevWindowStart && t < windowStart
  }

  const confirmed = bookings.filter((b) => b.status === 'confirmed')
  const confirmedInWindow = confirmed.filter(inWindow)
  const confirmedInPrevWindow = confirmed.filter(inPrevWindow)

  const totalBookings = confirmedInWindow.length
  const seatsSold = confirmedInWindow.reduce((sum, b) => sum + b.seats, 0)
  const totalBookingsDelta = percentDelta(totalBookings, confirmedInPrevWindow.length)
  const seatsSoldDelta = percentDelta(
    seatsSold,
    confirmedInPrevWindow.reduce((sum, b) => sum + b.seats, 0),
  )

  // Fill rate across upcoming slots, shared with the overview page via
  // `@repo/contracts` (ADR-001). Reads off `bookedCount`, the
  // atomic-reserve column.
  const upcoming = slots.filter((slot) => new Date(slot.startsAt).getTime() >= now)
  const fillRateValue = fillRate(upcoming)

  const bookingsInWindow = bookings.filter(inWindow)
  const cancelledInWindow = bookingsInWindow.filter((b) => b.status === 'cancelled')
  const cancellationRate =
    bookingsInWindow.length === 0
      ? null
      : Math.round((cancelledInWindow.length / bookingsInWindow.length) * 100)

  // Trend: confirmed bookings per UTC day for the last 7 days. Both the
  // bucket key and the booking `createdAt` are UTC ISO strings, so slicing to
  // the date part compares them on the same calendar.
  const trend: AnalyticsTrendPoint[] = []
  for (let i = TREND_DAYS - 1; i >= 0; i--) {
    const date = new Date(now - i * DAY_MS)
    const key = date.toISOString().slice(0, 10)
    // The bucket key is the UTC date part, so the label must come from the same
    // UTC instant — otherwise near midnight the local weekday can disagree with
    // the UTC bucket it labels.
    const label = date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
    const dayConfirmed = confirmed.filter((b) => b.createdAt.slice(0, 10) === key)
    trend.push({
      day: label,
      bookings: dayConfirmed.length,
      seats: dayConfirmed.reduce((sum, b) => sum + b.seats, 0),
    })
  }

  // Per-service breakdown: confirmed bookings in the window, joined through
  // the slot. Services with no bookings in the window are omitted so the bar
  // chart shows only what moved.
  const counts = new Map<string, number>()
  for (const booking of confirmedInWindow) {
    const slot = slotsById.get(booking.timeSlotId)
    if (!slot) continue
    const service = servicesById.get(slot.serviceId)
    if (!service) continue
    counts.set(service.title, (counts.get(service.title) ?? 0) + 1)
  }
  const byService: AnalyticsServicePoint[] = [...counts.entries()]
    .map(([service, count]) => ({ service, bookings: count }))
    .sort((a, b) => b.bookings - a.bookings)

  return {
    totalBookings,
    totalBookingsDelta,
    seatsSold,
    seatsSoldDelta,
    fillRate: fillRateValue,
    cancellationRate,
    windowBookings: bookingsInWindow.length,
    upcomingSlots: upcoming.length,
    trend,
    byService,
  }
}
