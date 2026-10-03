import { describe, expect, it } from 'vitest'

import { DEMO_ORGANIZER_ID, isDemoOrganizerId } from './demo'

describe('isDemoOrganizerId', () => {
  it('returns true for the demo organizer id', () => {
    expect(isDemoOrganizerId(DEMO_ORGANIZER_ID)).toBe(true)
  })

  it('returns false for a different organizer id', () => {
    expect(isDemoOrganizerId('01930000-0000-7000-8000-0000000000ff')).toBe(false)
  })

  it('returns false for null', () => {
    expect(isDemoOrganizerId(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isDemoOrganizerId(undefined)).toBe(false)
  })
})
