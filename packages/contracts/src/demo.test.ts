import { describe, expect, it } from 'vitest'

import {
  DEMO_ORGANIZER_ID,
  DEMO_ORGANIZER_SLUG,
  isDemoOrganizerId,
  isDemoOrganizerSlug,
} from './demo'

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

describe('isDemoOrganizerSlug', () => {
  it('returns true for the demo slug', () => {
    expect(isDemoOrganizerSlug(DEMO_ORGANIZER_SLUG)).toBe(true)
  })

  it('returns true for the demo slug with different casing', () => {
    expect(isDemoOrganizerSlug('Demo')).toBe(true)
    expect(isDemoOrganizerSlug('DEMO')).toBe(true)
  })

  it('returns false for a different slug', () => {
    expect(isDemoOrganizerSlug('yoga-studio')).toBe(false)
  })

  it('returns false for null', () => {
    expect(isDemoOrganizerSlug(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isDemoOrganizerSlug(undefined)).toBe(false)
  })
})
