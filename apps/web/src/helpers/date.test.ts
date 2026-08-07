import { describe, expect, it } from 'vitest'

import { formatDate, formatDateTime, formatTime } from './date'

describe('formatDate', () => {
  it('formats a date in the given timezone', () => {
    const iso = '2026-08-05T10:00:00.000Z'
    expect(formatDate(iso, 'UTC')).toMatch(/Aug/)
    expect(formatDate(iso, 'UTC')).toMatch(/5/)
  })

  it('respects the timezone — same instant, different zone, different date', () => {
    const iso = '2026-08-05T01:00:00.000Z'
    // In UTC it's Aug 5, in America/Los_Angeles (UTC-7) it's still Aug 4
    expect(formatDate(iso, 'UTC')).toMatch(/Aug.*5/)
    expect(formatDate(iso, 'America/Los_Angeles')).toMatch(/Aug.*4/)
  })

  it('includes the weekday abbreviation', () => {
    const iso = '2026-08-05T10:00:00.000Z' // Wednesday
    expect(formatDate(iso, 'UTC')).toMatch(/^Wed,/)
  })
})

describe('formatTime', () => {
  it('formats time in 24-hour format', () => {
    const iso = '2026-08-05T14:30:00.000Z'
    expect(formatTime(iso, 'UTC')).toBe('14:30')
  })

  it('respects the timezone', () => {
    const iso = '2026-08-05T14:30:00.000Z'
    // Europe/Belgrade is UTC+2 in August → 16:30
    expect(formatTime(iso, 'Europe/Belgrade')).toBe('16:30')
  })

  it('handles midnight', () => {
    const iso = '2026-08-05T00:00:00.000Z'
    // Some ICU environments render midnight as 24:00 with hour12:false
    const result = formatTime(iso, 'UTC')
    expect(result === '00:00' || result === '24:00').toBe(true)
  })
})

describe('formatDateTime', () => {
  it('combines date and time with a separator', () => {
    const iso = '2026-08-05T14:30:00.000Z'
    const result = formatDateTime(iso, 'UTC')
    expect(result).toContain('·')
    expect(result).toContain('14:30')
    expect(result).toMatch(/Aug.*5/)
  })
})
