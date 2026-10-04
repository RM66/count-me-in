import { instantToWallClockInputs, wallClockToInstant } from '@repo/contracts'

import { formatDate } from '@/helpers/date'

/**
 * The `YYYY-MM-DD` day key the cabinet filters group by, and the bridge
 * between it and the `Date`s UI controls work in.
 *
 * A day key is a *label* in the organizer's timezone; `DayPicker` works in
 * plain local `Date`s. Converting a key with `new Date(key)` would parse it as
 * UTC midnight and shift the highlight a day west of Greenwich, so the parts
 * are handed to the local constructor instead — the calendar square for "the
 * 2nd" is the same square whatever the browser's zone.
 */
export function dayKeyToDate(key: string): Date {
  return new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)))
}

/** Local calendar `Date` → `YYYY-MM-DD` day key. Inverse of {@link dayKeyToDate}. */
export function dateToDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`
}

/** Label for a day key — "Tue, Jul 22" rather than the raw `YYYY-MM-DD`.
 * Midday is picked so a DST gap can never shift the rendered date. */
export function formatDayLabel(day: string, timezone: string, locale: string): string {
  return formatDate(
    wallClockToInstant(
      {
        year: Number(day.slice(0, 4)),
        month: Number(day.slice(5, 7)),
        day: Number(day.slice(8, 10)),
        hour: 12, // Midday — never lands on a DST gap.
        minute: 0,
      },
      timezone,
    ).toISOString(),
    timezone,
    locale,
  )
}

/** The calendar day an instant falls on, **as the organizer sees it**.
 *
 * The instant is an ISO string, so slicing it would group by UTC day and
 * misfile every evening session for an organizer east of Greenwich. */
export function dayKeyOfInstant(startsAtIso: string, timezone: string): string {
  return instantToWallClockInputs(startsAtIso, timezone).date
}

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * A `YYYY-MM-DD` key that is also a real calendar date — the regex alone
 * would let 2026-02-30 through to a server 400. URL `?day=` params are
 * validated with this before they reach the API or the tables.
 */
export function isRealDayKey(value: string): boolean {
  return DAY_KEY_RE.test(value) && dateToDayKey(dayKeyToDate(value)) === value
}
