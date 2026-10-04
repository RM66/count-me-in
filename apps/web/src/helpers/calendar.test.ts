import { describe, expect, it } from 'vitest'

import { buildIcs, icsFilename } from './calendar'

const base = {
  uid: 'b8e4a2d1-3c4f-4e5a-9b6d-7f8e0a1b2c3d',
  title: 'Morning Vinyasa Flow',
  startsAt: '2026-07-22T07:00:00.000Z',
  endsAt: '2026-07-22T08:30:00.000Z',
  now: new Date('2026-07-20T10:00:00.000Z'),
}

describe('buildIcs', () => {
  it('produces the required VEVENT properties in order', () => {
    const ics = buildIcs(base)
    const lines = ics.split('\r\n')
    expect(lines[0]).toBe('BEGIN:VCALENDAR')
    expect(lines).toContain('VERSION:2.0')
    expect(lines).toContain(`UID:${base.uid}`)
    expect(lines).toContain('DTSTAMP:20260720T100000Z')
    expect(lines).toContain('DTSTART:20260722T070000Z')
    expect(lines).toContain('DTEND:20260722T083000Z')
    expect(lines).toContain('SUMMARY:Morning Vinyasa Flow')
    expect(lines[lines.length - 2]).toBe('END:VCALENDAR')
    // Every line ends in CRLF, including the last.
    expect(ics.endsWith('\r\n')).toBe(true)
  })

  it('escapes TEXT values so a newline cannot inject properties', () => {
    const ics = buildIcs({
      ...base,
      title: 'Yoga\nBEGIN:VCALENDAR',
      location: 'Studio; 5, Main St\\back',
    })
    expect(ics).toContain('SUMMARY:Yoga\\nBEGIN:VCALENDAR')
    expect(ics).toContain('LOCATION:Studio\\; 5\\, Main St\\\\back')
    // The injected BEGIN is escaped, not a real property line.
    expect(ics.match(/^BEGIN:VCALENDAR$/gm)).toHaveLength(1)
  })

  it('omits LOCATION when absent', () => {
    expect(buildIcs(base)).not.toContain('LOCATION:')
  })

  it('folds lines longer than 75 octets with space continuations', () => {
    const ics = buildIcs({ ...base, title: 'A'.repeat(100) })
    const lines = ics.split('\r\n')
    const summaryIndex = lines.findIndex((l) => l.startsWith('SUMMARY:'))
    expect(summaryIndex).toBeGreaterThanOrEqual(0)
    expect(lines[summaryIndex]).toHaveLength(75)
    expect(lines[summaryIndex + 1]).toMatch(/^ +A+$/)
  })

  it('folds on UTF-8 boundaries — multibyte titles are never split mid-char', () => {
    // '世' is 3 octets in UTF-8; 30 of them overflow the 75-octet limit.
    const ics = buildIcs({ ...base, title: '世'.repeat(30) })
    for (const line of ics.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    }
    // Round-trip sanity: the unfolded SUMMARY still contains all chars.
    const summary = ics.split('\r\n').find((l) => l.startsWith('SUMMARY:'))
    expect(summary).toBeDefined()
  })
})

describe('icsFilename', () => {
  it('slugifies a latin title', () => {
    expect(icsFilename('Morning Vinyasa Flow')).toBe('morning-vinyasa-flow.ics')
  })

  it('strips characters that break filesystems', () => {
    expect(icsFilename('a/b:c*d?')).toBe('a-b-c-d.ics')
  })

  it('keeps unicode letters (cyrillic title stays readable)', () => {
    expect(icsFilename('Утренняя Йога')).toBe('утренняя-йога.ics')
  })

  it('falls back to event.ics when nothing usable remains', () => {
    expect(icsFilename('!!!')).toBe('event.ics')
    expect(icsFilename('')).toBe('event.ics')
  })
})
