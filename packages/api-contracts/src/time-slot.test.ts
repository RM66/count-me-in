import { describe, expect, it } from 'vitest'

import {
  createTimeSlotInput,
  fillLabel,
  isAcceptableSlotStart,
  seatsLeft,
  SLOT_START_TOLERANCE_MS,
  slotEnd,
  slotPrice,
  updateTimeSlotInput,
} from './time-slot'

describe('seatsLeft', () => {
  it('returns capacity - bookedCount for a normal slot', () => {
    expect(seatsLeft({ capacity: 10, bookedCount: 3 })).toBe(7)
  })

  it('returns 0 for a full slot', () => {
    expect(seatsLeft({ capacity: 10, bookedCount: 10 })).toBe(0)
  })

  it('floors at 0 when bookedCount exceeds capacity', () => {
    expect(seatsLeft({ capacity: 5, bookedCount: 7 })).toBe(0)
  })

  it('returns full capacity when nothing is booked', () => {
    expect(seatsLeft({ capacity: 20, bookedCount: 0 })).toBe(20)
  })
})

describe('fillLabel', () => {
  it('returns "full" when no seats are left', () => {
    expect(fillLabel({ capacity: 10, bookedCount: 10 })).toBe('full')
  })

  it('returns "filling" when seats left are at or below 25% threshold', () => {
    // capacity 4, threshold = ceil(4 * 0.25) = 1 → 1 seat left = filling
    expect(fillLabel({ capacity: 4, bookedCount: 3 })).toBe('filling')
    // capacity 4, 0 seats left = full (checked first)
    expect(fillLabel({ capacity: 4, bookedCount: 4 })).toBe('full')
  })

  it('returns "open" when seats left are above the 25% threshold', () => {
    // capacity 40, threshold = ceil(40 * 0.25) = 10 → 37 left = open
    expect(fillLabel({ capacity: 40, bookedCount: 3 })).toBe('open')
  })

  it('returns "filling" at the exact threshold boundary', () => {
    // capacity 8, threshold = ceil(8 * 0.25) = 2 → 2 left = filling
    expect(fillLabel({ capacity: 8, bookedCount: 6 })).toBe('filling')
    // 3 left = open
    expect(fillLabel({ capacity: 8, bookedCount: 5 })).toBe('open')
  })
})

describe('slotEnd', () => {
  it('returns startsAt + durationMinutes as an ISO string', () => {
    const result = slotEnd({ startsAt: '2026-07-25T07:00:00.000Z', durationMinutes: 60 })
    expect(result).toBe('2026-07-25T08:00:00.000Z')
  })

  it('handles a 90-minute slot', () => {
    const result = slotEnd({ startsAt: '2026-07-25T07:00:00.000Z', durationMinutes: 90 })
    expect(result).toBe('2026-07-25T08:30:00.000Z')
  })

  it('handles a slot that crosses midnight', () => {
    const result = slotEnd({ startsAt: '2026-07-25T23:30:00.000Z', durationMinutes: 60 })
    expect(result).toBe('2026-07-26T00:30:00.000Z')
  })
})

describe('slotPrice', () => {
  it('returns the slot override when set', () => {
    expect(slotPrice({ price: '€20' }, { defaultPrice: '€15' })).toBe('€20')
  })

  it('falls back to the service default when slot has no price', () => {
    expect(slotPrice({ price: null }, { defaultPrice: '€15' })).toBe('€15')
  })

  it('falls back to the service default when slot price is undefined', () => {
    expect(slotPrice({}, { defaultPrice: '€15' })).toBe('€15')
  })

  it('returns empty string when neither slot nor service has a price', () => {
    expect(slotPrice({ price: null }, { defaultPrice: null })).toBe('')
    expect(slotPrice({}, {})).toBe('')
  })
})

describe('isAcceptableSlotStart', () => {
  it('accepts a future start time', () => {
    const now = new Date('2026-07-25T12:00:00.000Z')
    const future = new Date('2026-07-25T13:00:00.000Z')
    expect(isAcceptableSlotStart(future, now)).toBe(true)
  })

  it('accepts a start time within the tolerance window', () => {
    const now = new Date('2026-07-25T12:00:00.000Z')
    // 30 seconds ago — within the 60s tolerance
    const recent = new Date(now.getTime() - 30_000)
    expect(isAcceptableSlotStart(recent, now)).toBe(true)
  })

  it('rejects a start time more than the tolerance in the past', () => {
    const now = new Date('2026-07-25T12:00:00.000Z')
    // 2 minutes ago — beyond the 60s tolerance
    const past = new Date(now.getTime() - 120_000)
    expect(isAcceptableSlotStart(past, now)).toBe(false)
  })

  it('accepts a start time exactly at the tolerance boundary', () => {
    const now = new Date('2026-07-25T12:00:00.000Z')
    // Exactly SLOT_START_TOLERANCE_MS ago — the check is `> now - tolerance`,
    // so exactly at the boundary is NOT accepted (strict >)
    const boundary = new Date(now.getTime() - SLOT_START_TOLERANCE_MS)
    expect(isAcceptableSlotStart(boundary, now)).toBe(false)
  })
})

describe('createTimeSlotInput', () => {
  const validInput = {
    serviceId: 'svc-abc',
    startsAt: new Date(Date.now() + 3600_000).toISOString(),
    durationMinutes: 60,
    capacity: 10,
  }

  it('parses a valid input', () => {
    const result = createTimeSlotInput.safeParse(validInput)
    expect(result.success).toBe(true)
  })

  it('rejects a past startsAt', () => {
    const result = createTimeSlotInput.safeParse({
      ...validInput,
      startsAt: new Date(Date.now() - 3600_000).toISOString(),
    })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid capacity', () => {
    const result = createTimeSlotInput.safeParse({
      ...validInput,
      capacity: 0,
    })
    expect(result.success).toBe(false)
  })
})

describe('updateTimeSlotInput', () => {
  it('parses a partial update with only durationMinutes', () => {
    const result = updateTimeSlotInput.safeParse({ durationMinutes: 90 })
    expect(result.success).toBe(true)
  })

  it('allows undefined startsAt (leave unchanged)', () => {
    const result = updateTimeSlotInput.safeParse({ capacity: 20 })
    expect(result.success).toBe(true)
  })

  it('rejects a past startsAt when provided', () => {
    const result = updateTimeSlotInput.safeParse({
      startsAt: new Date(Date.now() - 3600_000).toISOString(),
    })
    expect(result.success).toBe(false)
  })
})
