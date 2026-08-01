/**
 * Wall-clock ↔ instant conversion for a named IANA timezone.
 *
 * The cabinet asks for a slot as an organizer thinks of it — "the 25th at
 * 07:00" — while `time_slots.startsAt` is a `timestamptz`, i.e. an instant.
 * Turning one into the other needs the organizer's timezone, and `new
 * Date('2026-07-25T07:00')` cannot do it: that parses in the *runtime's* zone,
 * so a slot created from a laptop in Belgrade and one created from a server in
 * UTC would land two hours apart.
 *
 * Isomorphic on purpose. The form parses with it in the browser, and the same
 * offsets must be reproducible on the server and in the worker, so it lives
 * here rather than in `apps/web`.
 *
 * Implemented with `Intl` only — no date library — because the one thing needed
 * is the UTC offset a zone had *at a given instant*, which `formatToParts`
 * already answers correctly for historical and DST-shifted dates alike.
 */

/** Calendar fields as a human reads them off a clock on the wall. */
export interface WallClock {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

/**
 * Offset (ms) between `timeZone` and UTC at `instant` — positive east of
 * Greenwich. Derived by formatting the instant into the zone and reading the
 * result back as if it were UTC; the difference is the offset in force.
 */
function offsetAt(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)

  const field: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {}
  for (const part of parts) {
    if (part.type !== 'literal') field[part.type] = Number(part.value)
  }

  const asIfUtc = Date.UTC(
    field.year ?? 0,
    (field.month ?? 1) - 1,
    field.day ?? 1,
    // `hour12: false` yields 24 for midnight in some ICU versions.
    (field.hour ?? 0) % 24,
    field.minute ?? 0,
    field.second ?? 0,
  )

  return asIfUtc - instant.getTime()
}

/**
 * The instant at which `wall` reads on a clock in `timeZone`.
 *
 * Resolved in two passes because the offset depends on the very instant being
 * computed: the first guess uses the offset at the naive UTC reading, the
 * second re-checks it at the resulting instant. That second pass is what makes
 * times just after a DST transition land correctly instead of an hour out.
 *
 * Ambiguous and skipped wall-clock times (the hour a DST jump repeats or
 * removes) resolve to a single defined instant rather than throwing — a slot
 * scheduled inside the gap is a scheduling curiosity, not an input error.
 */
export function wallClockToInstant(wall: WallClock, timeZone: string): Date {
  const naiveUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute)

  const firstGuess = offsetAt(new Date(naiveUtc), timeZone)
  const candidate = new Date(naiveUtc - firstGuess)

  const settled = offsetAt(candidate, timeZone)
  return settled === firstGuess ? candidate : new Date(naiveUtc - settled)
}

/** Two-digit zero padding for `<input>`-shaped values. */
function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * Split an instant into the `value` strings an `<input type="date">` and an
 * `<input type="time">` expect (`YYYY-MM-DD` / `HH:mm`), as read in `timeZone`.
 *
 * The exact inverse of {@link wallClockToInstant}, so seeding an edit form from
 * a stored slot and saving it again without touching a field is a no-op.
 */
export function instantToWallClockInputs(
  iso: string,
  timeZone: string,
): { date: string; time: string } {
  const instant = new Date(iso)
  const shifted = new Date(instant.getTime() + offsetAt(instant, timeZone))

  return {
    date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    time: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`,
  }
}
