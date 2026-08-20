import { describe, expect, it } from 'vitest'

import {
  bookingRecord,
  cancelBookingByTokenInput,
  createBookingInput,
  guestBooking,
} from './booking'

describe('createBookingInput', () => {
  const validPayload = {
    serviceId: 'svc-abc',
    timeSlotId: '01930000-0000-7000-8000-000000000001',
    seats: 1,
    guestName: 'Jane Doe',
    guestTicket: 'a-very-long-auth-ticket-value',
  }

  it('parses a valid payload', () => {
    const result = createBookingInput.safeParse(validPayload)
    expect(result.success).toBe(true)
  })

  it('rejects a missing guestTicket', () => {
    const result = createBookingInput.safeParse({ ...validPayload, guestTicket: undefined })
    expect(result.success).toBe(false)
  })

  it('rejects seats=0', () => {
    const result = createBookingInput.safeParse({ ...validPayload, seats: 0 })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid uuid for timeSlotId', () => {
    const result = createBookingInput.safeParse({ ...validPayload, timeSlotId: 'not-a-uuid' })
    expect(result.success).toBe(false)
  })

  it('defaults guestLocale to en when omitted (ADR-011)', () => {
    const result = createBookingInput.safeParse(validPayload)
    expect(result.success && result.data.guestLocale).toBe('en')
  })

  it('accepts a supported guestLocale and rejects others', () => {
    expect(createBookingInput.safeParse({ ...validPayload, guestLocale: 'ru' }).success).toBe(true)
    expect(createBookingInput.safeParse({ ...validPayload, guestLocale: 'fr' }).success).toBe(true)
    expect(createBookingInput.safeParse({ ...validPayload, guestLocale: 'pt' }).success).toBe(
      false,
    )
  })
})

describe('cancelBookingByTokenInput', () => {
  it('parses a valid token', () => {
    const result = cancelBookingByTokenInput.safeParse({
      manageToken: 'a'.repeat(32),
    })
    expect(result.success).toBe(true)
  })

  it('rejects a short token', () => {
    const result = cancelBookingByTokenInput.safeParse({ manageToken: 'short' })
    expect(result.success).toBe(false)
  })
})

describe('bookingRecord (organizer view)', () => {
  const validRecord = {
    id: '01930000-0000-7000-8000-000000000001',
    timeSlotId: '01930000-0000-7000-8000-000000000002',
    status: 'confirmed',
    seats: 2,
    guestName: 'Jane Doe',
    guestMessenger: 'telegram',
    guestMessengerId: '12345',
    guestMessengerLogin: 'janedoe',
    selectedOptions: ['Beginner'],
    createdAt: '2026-07-25T10:00:00.000Z',
  }

  it('parses a valid record', () => {
    const result = bookingRecord.safeParse(validRecord)
    expect(result.success).toBe(true)
  })

  it('does not include a manageToken field (security invariant)', () => {
    const result = bookingRecord.safeParse({
      ...validRecord,
      manageToken: 'should-not-be-here',
    })
    // Zod strips unknown keys by default, so it parses — but the data has no manageToken
    expect(result.success).toBe(true)
    expect(result.data).not.toHaveProperty('manageToken')
  })
})

describe('guestBooking (guest view)', () => {
  const validGuestBooking = {
    id: '01930000-0000-7000-8000-000000000001',
    status: 'confirmed',
    seats: 2,
    guestName: 'Jane Doe',
    selectedOptions: ['Beginner'],
    createdAt: '2026-07-25T10:00:00.000Z',
    manageToken: 'a'.repeat(32),
    slot: {
      id: '01930000-0000-7000-8000-000000000002',
      serviceId: 'svc-abc',
      startsAt: '2026-07-25T07:00:00.000Z',
      durationMinutes: 60,
      capacity: 10,
      bookedCount: 2,
      price: '€15',
      createdAt: '2026-07-20T10:00:00.000Z',
    },
    service: {
      id: 'svc-abc',
      organizerId: '01930000-0000-7000-8000-000000000003',
      title: 'Morning Yoga',
      description: null,
      photoUrl: null,
      location: null,
      contact: null,
      defaultPrice: '€15',
      defaultCapacity: 10,
      defaultDurationMinutes: 60,
      maxSeatsPerBooking: 1,
      options: ['Beginner'],
      optionsSelectMode: 'single',
      createdAt: '2026-07-15T10:00:00.000Z',
    },
    organizer: {
      id: '01930000-0000-7000-8000-000000000003',
      slug: 'yoga-studio',
      name: 'Yoga Studio',
      timezone: 'Europe/Belgrade',
      photoUrl: null,
      description: null,
      location: null,
      contact: null,
      isDemo: false,
    },
  }

  it('parses a valid guest booking', () => {
    const result = guestBooking.safeParse(validGuestBooking)
    expect(result.success).toBe(true)
  })

  it('includes manageToken (guest owns their cancellation secret)', () => {
    const result = guestBooking.safeParse(validGuestBooking)
    expect(result.success).toBe(true)
    expect(result.data).toHaveProperty('manageToken')
  })
})
