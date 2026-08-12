import { describe, expect, it } from 'vitest'

import { instantToWallClockInputs, wallClockToInstant } from './timezone'

describe('wallClockToInstant', () => {
  it('converts a UTC wall-clock time to the correct instant', () => {
    const result = wallClockToInstant({ year: 2026, month: 7, day: 25, hour: 7, minute: 0 }, 'UTC')
    expect(result.toISOString()).toBe('2026-07-25T07:00:00.000Z')
  })

  it('applies a positive offset for Europe/Belgrade (UTC+2 in summer)', () => {
    const result = wallClockToInstant(
      { year: 2026, month: 7, day: 25, hour: 7, minute: 0 },
      'Europe/Belgrade',
    )
    // Belgrade is UTC+2 in July (CEST), so 07:00 local = 05:00 UTC
    expect(result.toISOString()).toBe('2026-07-25T05:00:00.000Z')
  })

  it('applies a negative offset for America/Los_Angeles (UTC-7 in summer)', () => {
    const result = wallClockToInstant(
      { year: 2026, month: 7, day: 25, hour: 7, minute: 0 },
      'America/Los_Angeles',
    )
    // PDT is UTC-7 in July, so 07:00 local = 14:00 UTC
    expect(result.toISOString()).toBe('2026-07-25T14:00:00.000Z')
  })

  it('handles a winter date when Belgrade is UTC+1 (CET, no DST)', () => {
    const result = wallClockToInstant(
      { year: 2026, month: 1, day: 15, hour: 7, minute: 0 },
      'Europe/Belgrade',
    )
    // CET is UTC+1 in January, so 07:00 local = 06:00 UTC
    expect(result.toISOString()).toBe('2026-01-15T06:00:00.000Z')
  })

  it('resolves a DST spring-forward gap to a single defined instant', () => {
    // In Europe/Belgrade, DST starts 2026-03-29 at 02:00 → 03:00.
    // 02:30 does not exist on the wall clock; the function must not throw.
    const result = wallClockToInstant(
      { year: 2026, month: 3, day: 29, hour: 2, minute: 30 },
      'Europe/Belgrade',
    )
    expect(result).toBeInstanceOf(Date)
    // The instant should be somewhere in the gap — either 01:00 or 02:00 UTC
    const iso = result.toISOString()
    expect(iso).toMatch(/^2026-03-29T0[12]:30:00\.000Z$/)
  })

  it('resolves a DST fall-back ambiguous hour consistently', () => {
    // In Europe/Belgrade, DST ends 2026-10-25 at 03:00 → 02:00.
    // 02:30 occurs twice; the function must pick one consistently.
    const result = wallClockToInstant(
      { year: 2026, month: 10, day: 25, hour: 2, minute: 30 },
      'Europe/Belgrade',
    )
    expect(result).toBeInstanceOf(Date)
    // Should be either 00:30 (CEST) or 01:30 (CET) UTC
    const iso = result.toISOString()
    expect(iso).toMatch(/^2026-10-25T0[01]:30:00\.000Z$/)
  })

  it('round-trips through instantToWallClockInputs as a no-op', () => {
    const tz = 'Europe/Belgrade'
    const wall = { year: 2026, month: 7, day: 25, hour: 7, minute: 30 }
    const instant = wallClockToInstant(wall, tz)
    const inputs = instantToWallClockInputs(instant.toISOString(), tz)
    const roundTripped = wallClockToInstant(
      {
        year: Number(inputs.date.slice(0, 4)),
        month: Number(inputs.date.slice(5, 7)),
        day: Number(inputs.date.slice(8, 10)),
        hour: Number(inputs.time.slice(0, 2)),
        minute: Number(inputs.time.slice(3, 5)),
      },
      tz,
    )
    expect(roundTripped.toISOString()).toBe(instant.toISOString())
  })
})

describe('instantToWallClockInputs', () => {
  it('returns YYYY-MM-DD and HH:mm strings', () => {
    const result = instantToWallClockInputs('2026-07-25T05:00:00.000Z', 'Europe/Belgrade')
    expect(result.date).toBe('2026-07-25')
    expect(result.time).toBe('07:00')
  })

  it('reads in the given timezone, not the runtime zone', () => {
    // Same instant, two zones → different wall-clock readings
    const belgrade = instantToWallClockInputs('2026-07-25T05:00:00.000Z', 'Europe/Belgrade')
    const la = instantToWallClockInputs('2026-07-25T05:00:00.000Z', 'America/Los_Angeles')
    expect(belgrade.date).toBe('2026-07-25')
    expect(belgrade.time).toBe('07:00')
    expect(la.date).toBe('2026-07-24')
    expect(la.time).toBe('22:00')
  })

  it('produces correct wall-clock fields across a DST transition', () => {
    // Just before DST starts in Belgrade (2026-03-29 02:00 → 03:00):
    // 01:59 CET (UTC+1) = 00:59 UTC
    const before = instantToWallClockInputs('2026-03-29T00:59:00.000Z', 'Europe/Belgrade')
    expect(before.time).toBe('01:59')

    // After: 03:00 CEST (UTC+2) = 01:00 UTC
    const after = instantToWallClockInputs('2026-03-29T01:00:00.000Z', 'Europe/Belgrade')
    expect(after.time).toBe('03:00')
  })

  it('is the exact inverse of wallClockToInstant', () => {
    const tz = 'America/Los_Angeles'
    const instant = wallClockToInstant({ year: 2026, month: 12, day: 31, hour: 23, minute: 45 }, tz)
    const inputs = instantToWallClockInputs(instant.toISOString(), tz)
    expect(inputs.date).toBe('2026-12-31')
    expect(inputs.time).toBe('23:45')
  })
})
