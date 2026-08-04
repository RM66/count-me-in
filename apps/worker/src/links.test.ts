import { describe, expect, it } from 'vitest'

import { cabinetSlotPath, loginLinkUrl, manageBookingUrl, organizerPageUrl } from './links'

describe('cabinetSlotPath', () => {
  it('returns the cabinet bookings path with the slot id', () => {
    expect(cabinetSlotPath('slot-123')).toBe('/cabinet/bookings?slot=slot-123')
  })

  it('encodes special characters in the slot id', () => {
    expect(cabinetSlotPath('slot 123')).toBe('/cabinet/bookings?slot=slot%20123')
  })
})

describe('loginLinkUrl', () => {
  it('returns the login link URL with the token', () => {
    expect(loginLinkUrl('https://countmein.group', 'abc123')).toBe(
      'https://countmein.group/login/link/abc123',
    )
  })

  it('encodes special characters in the token', () => {
    expect(loginLinkUrl('https://countmein.group', 'ab+c123')).toBe(
      'https://countmein.group/login/link/ab%2Bc123',
    )
  })
})

describe('manageBookingUrl', () => {
  it('returns the booking management URL with the token', () => {
    expect(manageBookingUrl('https://countmein.group', 'manage-token-123')).toBe(
      'https://countmein.group/booking/manage-token-123',
    )
  })

  it('encodes special characters in the token', () => {
    expect(manageBookingUrl('https://countmein.group', 'tok/en')).toBe(
      'https://countmein.group/booking/tok%2Fen',
    )
  })
})

describe('organizerPageUrl', () => {
  it('returns the organizer public page URL with the slug', () => {
    expect(organizerPageUrl('https://countmein.group', 'yoga-studio')).toBe(
      'https://countmein.group/yoga-studio',
    )
  })

  it('encodes special characters in the slug', () => {
    expect(organizerPageUrl('https://countmein.group', 'café club')).toBe(
      'https://countmein.group/caf%C3%A9%20club',
    )
  })
})
