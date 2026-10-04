import { describe, expect, it } from 'vitest'

import { detectTimezone } from './use-signup-form'

describe('detectTimezone', () => {
  it('returns the browser-detected timezone', () => {
    expect(detectTimezone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  })

  it('returns an unlisted but valid zone — the caller adds it to the options', () => {
    const original = Intl.DateTimeFormat.prototype.resolvedOptions
    Intl.DateTimeFormat.prototype.resolvedOptions = () =>
      ({ timeZone: 'Pacific/Auckland' }) as Intl.ResolvedDateTimeFormatOptions

    try {
      expect(detectTimezone()).toBe('Pacific/Auckland')
    } finally {
      Intl.DateTimeFormat.prototype.resolvedOptions = original
    }
  })

  it('falls back to UTC when detection reports nothing', () => {
    const original = Intl.DateTimeFormat.prototype.resolvedOptions
    Intl.DateTimeFormat.prototype.resolvedOptions = () =>
      ({ timeZone: undefined }) as unknown as Intl.ResolvedDateTimeFormatOptions

    try {
      expect(detectTimezone()).toBe('UTC')
    } finally {
      Intl.DateTimeFormat.prototype.resolvedOptions = original
    }
  })
})
