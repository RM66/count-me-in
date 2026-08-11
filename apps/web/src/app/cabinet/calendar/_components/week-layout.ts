/**
 * Pure geometry for the week grid — everything that turns slots into positions
 * without touching React or the DOM, so it can be unit-tested on its own.
 *
 * Time is handled as wall-clock minutes-from-midnight in the organizer's
 * timezone: the component derives those with `instantToWallClockInputs`, and
 * this module never sees an instant. That keeps the one hard problem (which
 * calendar day and clock time an instant falls on) in a single, already-tested
 * place.
 */

/** Minutes in a day — the grid's full vertical extent. */
export const MINUTES_PER_DAY = 24 * 60

/**
 * 00:00 of the week containing `date`, as a local `Date`.
 *
 * `weekStartsOn` follows react-day-picker's convention (0 = Sunday …
 * 6 = Saturday) so the grid and the mini pickers agree on which day a week
 * opens on; it defaults to Monday, the project's European default (prices in
 * RSD, Belgrade timezone). Normalised to midnight so the seven day keys are
 * stable regardless of the time of day passed in.
 */
export function startOfWeek(date: Date, weekStartsOn = 1): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const sinceStart = (d.getDay() - weekStartsOn + 7) % 7 // getDay(): 0 = Sunday
  d.setDate(d.getDate() - sinceStart)
  return d
}

/** `date` shifted by `days`, as a fresh local `Date`. */
export function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

/** `"HH:mm"` → minutes since midnight. Inverse of the padded wall-clock time. */
export function timeToMinutes(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number)
  return hours * 60 + minutes
}

/** An event to be placed, before its horizontal lane is known. */
export interface UnplacedEvent<T> {
  item: T
  startMin: number
  endMin: number
}

/** An event once its lane within a cluster of overlaps has been assigned. */
export interface PlacedEvent<T> extends UnplacedEvent<T> {
  /** Zero-based column within its overlap cluster. */
  col: number
  /** How many columns that cluster was split into — the event's width divisor. */
  cols: number
}

/**
 * Assign side-by-side columns to overlapping events, the way a day calendar
 * splits a busy hour into parallel tracks.
 *
 * Events are swept in start order and grouped into clusters that transitively
 * overlap; within a cluster each event takes the first column whose previous
 * occupant has already ended, or opens a new one. Every event in a cluster is
 * then told the cluster's total width so the rendered blocks tile it exactly.
 */
export function assignColumns<T>(events: UnplacedEvent<T>[]): PlacedEvent<T>[] {
  const sorted = [...events].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)

  const placed: PlacedEvent<T>[] = []
  let cluster: PlacedEvent<T>[] = []
  let clusterEnd = -1

  const flush = () => {
    if (cluster.length === 0) return
    // `colEnds[i]` is the end minute of the last event placed in column `i`.
    const colEnds: number[] = []
    for (const event of cluster) {
      let column = colEnds.findIndex((end) => end <= event.startMin)
      if (column === -1) {
        column = colEnds.length
        colEnds.push(event.endMin)
      } else {
        colEnds[column] = event.endMin
      }
      event.col = column
    }
    for (const event of cluster) event.cols = colEnds.length
    placed.push(...cluster)
    cluster = []
    clusterEnd = -1
  }

  for (const event of sorted) {
    // A gap with the running cluster maximum closes the cluster: nothing after
    // this point can overlap anything before it.
    if (cluster.length > 0 && event.startMin >= clusterEnd) flush()
    cluster.push({ ...event, col: 0, cols: 1 })
    clusterEnd = Math.max(clusterEnd, event.endMin)
  }
  flush()

  return placed
}
