import { describe, expect, it } from 'vitest'

import { detectTimezone } from './use-signup-form'

describe('detectTimezone', () => {
  const timezones = [
    { value: 'Europe/Belgrade' },
    { value: 'Europe/Moscow' },
    { value: 'America/New_York' },
  ]

  it('returns the detected timezone when it is in the list', () => {
    // The test environment's timezone is whatever the runner uses.
    // We test the logic: if Intl reports a zone that is in the list, it is returned.
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
    const result = detectTimezone(timezones)
    if (timezones.some((tz) => tz.value === detected)) {
      expect(result).toBe(detected)
    } else {
      // If the detected zone is not in the list, fallback is used
      expect(result).toBe('Europe/Belgrade')
    }
  })

  it('falls back to Europe/Belgrade when the detected timezone is not in the list', () => {
    // Mock Intl to return a timezone not in the list
    const original = Intl.DateTimeFormat
    const originalResolved = original.prototype.resolvedOptions
    original.prototype.resolvedOptions = () =>
      ({ timeZone: 'Pacific/Auckland' }) as Intl.ResolvedDateTimeFormatOptions

    try {
      const result = detectTimezone(timezones)
      expect(result).toBe('Europe/Belgrade')
    } finally {
      original.prototype.resolvedOptions = originalResolved
    }
  })

  it('falls back when the detected timezone is undefined', () => {
    const original = Intl.DateTimeFormat
    const originalResolved = original.prototype.resolvedOptions
    original.prototype.resolvedOptions = () =>
      ({ timeZone: undefined }) as unknown as Intl.ResolvedDateTimeFormatOptions

    try {
      const result = detectTimezone(timezones)
      expect(result).toBe('Europe/Belgrade')
    } finally {
      original.prototype.resolvedOptions = originalResolved
    }
  })

  it('returns the detected zone when it matches exactly', () => {
    const original = Intl.DateTimeFormat
    const originalResolved = original.prototype.resolvedOptions
    original.prototype.resolvedOptions = () =>
      ({ timeZone: 'Europe/Moscow' }) as Intl.ResolvedDateTimeFormatOptions

    try {
      const result = detectTimezone(timezones)
      expect(result).toBe('Europe/Moscow')
    } finally {
      original.prototype.resolvedOptions = originalResolved
    }
  })

  it('falls back to Europe/Belgrade with an empty timezone list', () => {
    const result = detectTimezone([])
    expect(result).toBe('Europe/Belgrade')
  })
})
