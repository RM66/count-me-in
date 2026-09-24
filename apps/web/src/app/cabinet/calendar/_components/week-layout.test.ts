import { describe, expect, it } from 'vitest'

import { dateToDayKey } from '@/app/cabinet/_components/day-filter'
import { addDays, assignColumns, startOfWeek, timeToMinutes } from './week-layout'

// the week grid's pure geometry. Wall-clock minutes only — the
// module never sees an instant, so DST and midnight crossings are the
// caller's concern; here we pin the layout math itself.

describe('startOfWeek', () => {
  it('opens on Monday by default (European convention)', () => {
    // 2026-07-25 is a Saturday.
    const saturday = new Date(2026, 6, 25)
    const monday = startOfWeek(saturday)
    expect(monday.getDay()).toBe(1)
    expect(dateToDayKey(monday)).toBe('2026-07-20')
  })

  it('normalizes to midnight regardless of the time of day passed', () => {
    const evening = new Date(2026, 6, 25, 22, 45)
    const monday = startOfWeek(evening)
    expect(monday.getHours()).toBe(0)
    expect(monday.getMinutes()).toBe(0)
  })

  it('returns the same Monday when given that Monday itself', () => {
    const monday = new Date(2026, 6, 20, 9, 0)
    expect(dateToDayKey(startOfWeek(monday))).toBe('2026-07-20')
  })

  it('honours a Sunday week start', () => {
    // 2026-07-25 Saturday, week starting Sunday → 2026-07-19.
    expect(dateToDayKey(startOfWeek(new Date(2026, 6, 25), 0))).toBe('2026-07-19')
  })
})

describe('addDays', () => {
  it('shifts across a month boundary', () => {
    const july31 = new Date(2026, 6, 31)
    const aug1 = addDays(july31, 1)
    expect(dateToDayKey(aug1)).toBe('2026-08-01')
  })
})

describe('timeToMinutes', () => {
  it('converts HH:mm to minutes since midnight', () => {
    expect(timeToMinutes('00:00')).toBe(0)
    expect(timeToMinutes('09:30')).toBe(570)
    expect(timeToMinutes('23:59')).toBe(1439)
  })
})

describe('assignColumns', () => {
  it('gives non-overlapping events their own full-width columns', () => {
    const placed = assignColumns([
      { item: 'a', startMin: 0, endMin: 60 },
      { item: 'b', startMin: 120, endMin: 180 },
    ])
    expect(placed.map((e) => [e.item, e.col, e.cols])).toEqual([
      ['a', 0, 1],
      ['b', 0, 1],
    ])
  })

  it('splits a busy hour into parallel tracks', () => {
    const placed = assignColumns([
      { item: 'a', startMin: 0, endMin: 120 },
      { item: 'b', startMin: 30, endMin: 90 },
      { item: 'c', startMin: 60, endMin: 150 },
    ])
    // All three transitively overlap → one cluster of 3 columns.
    expect(placed.map((e) => [e.item, e.col, e.cols])).toEqual([
      ['a', 0, 3],
      ['b', 1, 3],
      ['c', 2, 3],
    ])
  })

  it('reuses a column once its previous occupant has ended', () => {
    const placed = assignColumns([
      { item: 'a', startMin: 0, endMin: 60 },
      { item: 'b', startMin: 0, endMin: 60 },
      // Starts exactly when a ends — back-to-back, not overlapping. The
      // gap closes the first cluster, so c opens a fresh one and gets
      // the full width.
      { item: 'c', startMin: 60, endMin: 120 },
    ])
    expect(placed.map((e) => [e.item, e.col, e.cols])).toEqual([
      ['a', 0, 2],
      ['b', 1, 2],
      ['c', 0, 1],
    ])
  })

  it('closes a cluster at a gap: later events get a fresh cluster', () => {
    const placed = assignColumns([
      { item: 'a', startMin: 0, endMin: 60 },
      { item: 'b', startMin: 0, endMin: 60 },
      { item: 'c', startMin: 300, endMin: 360 },
    ])
    // The afternoon event is alone in its cluster — full width again.
    expect(placed.map((e) => [e.item, e.col, e.cols])).toEqual([
      ['a', 0, 2],
      ['b', 1, 2],
      ['c', 0, 1],
    ])
  })

  it('sorts by start time regardless of input order', () => {
    const placed = assignColumns([
      { item: 'late', startMin: 200, endMin: 260 },
      { item: 'early', startMin: 0, endMin: 60 },
    ])
    expect(placed.map((e) => e.item)).toEqual(['early', 'late'])
  })

  it('returns an empty list unchanged', () => {
    expect(assignColumns([])).toEqual([])
  })
})
