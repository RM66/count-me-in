import { describe, expect, it } from 'vitest'

import {
  createServiceInput,
  effectiveContact,
  effectiveLocation,
  updateServiceInput,
} from './service'

describe('effectiveLocation', () => {
  it('returns the service location when set', () => {
    expect(effectiveLocation({ location: 'Studio A' }, { location: 'Gym B' })).toBe('Studio A')
  })

  it('falls back to the organizer location when service has none', () => {
    expect(effectiveLocation({ location: null }, { location: 'Gym B' })).toBe('Gym B')
    expect(effectiveLocation({}, { location: 'Gym B' })).toBe('Gym B')
  })

  it('returns undefined when neither has a location', () => {
    expect(effectiveLocation({ location: null }, { location: null })).toBeUndefined()
    expect(effectiveLocation({}, {})).toBeUndefined()
  })
})

describe('effectiveContact', () => {
  it('returns the service contact when set', () => {
    expect(effectiveContact({ contact: '+381 60 123' }, { contact: 'a@b.com' })).toBe('+381 60 123')
  })

  it('falls back to the organizer contact when service has none', () => {
    expect(effectiveContact({ contact: null }, { contact: 'a@b.com' })).toBe('a@b.com')
  })

  it('returns undefined when neither has a contact', () => {
    expect(effectiveContact({}, {})).toBeUndefined()
  })
})

describe('createServiceInput', () => {
  const validBase = {
    title: 'Morning Yoga',
    defaultPrice: '€15',
    defaultCapacity: 10,
    defaultDurationMinutes: 60,
    maxSeatsPerBooking: 1,
  }

  it('parses a valid service without options', () => {
    const result = createServiceInput.safeParse(validBase)
    expect(result.success).toBe(true)
  })

  it('parses a valid service with options and mode', () => {
    const result = createServiceInput.safeParse({
      ...validBase,
      options: ['Beginner', 'Intermediate'],
      optionsSelectMode: 'single',
    })
    expect(result.success).toBe(true)
  })

  it('rejects options without optionsSelectMode', () => {
    const result = createServiceInput.safeParse({
      ...validBase,
      options: ['Beginner'],
    })
    expect(result.success).toBe(false)
  })

  it('rejects optionsSelectMode without options', () => {
    const result = createServiceInput.safeParse({
      ...validBase,
      optionsSelectMode: 'single',
    })
    expect(result.success).toBe(false)
  })

  it('accepts omitted options and mode (no options)', () => {
    // createServiceInput uses .optional() (not .nullable()), so omitting
    // both fields is the way to create a service with no options.
    const result = createServiceInput.safeParse(validBase)
    expect(result.success).toBe(true)
    expect(result.data).not.toHaveProperty('options')
  })
})

describe('updateServiceInput', () => {
  it('parses a partial update', () => {
    const result = updateServiceInput.safeParse({ title: 'Updated Title' })
    expect(result.success).toBe(true)
  })

  it('accepts null to clear a field', () => {
    const result = updateServiceInput.safeParse({ description: null })
    expect(result.success).toBe(true)
  })

  it('accepts undefined fields (leave unchanged)', () => {
    const result = updateServiceInput.safeParse({})
    expect(result.success).toBe(true)
  })
})
