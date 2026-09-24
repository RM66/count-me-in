import { describe, expect, it } from 'vitest'

import type { ServiceRecord } from './service'
import { serviceFormSchema, toCreateServiceInput, toServiceFormValues } from './service-form'

// the form schema is the seam between controlled string inputs and
// the wire contract. The load-bearing rules: `''` collapses to `null`
// (clear the column), numbers parse from text, and the options pair
// (`options` + `optionsSelectMode`) always travels together — an empty
// list clears both, a non-empty list requires both.

const validValues = {
  title: 'Morning Yoga',
  description: '',
  location: '',
  contact: '',
  defaultPrice: '15 EUR',
  defaultCapacity: '10',
  defaultDurationMinutes: '60',
  maxSeatsPerBooking: '4',
  options: [] as string[],
  optionsSelectMode: 'single' as const,
  photoUrl: null,
}

describe('serviceFormSchema', () => {
  it('parses numeric text fields into numbers', () => {
    const parsed = serviceFormSchema.parse(validValues)
    expect(parsed.defaultCapacity).toBe(10)
    expect(parsed.defaultDurationMinutes).toBe(60)
    expect(parsed.maxSeatsPerBooking).toBe(4)
  })

  it("collapses '' to null for optional text (clear-the-column semantics)", () => {
    const parsed = serviceFormSchema.parse(validValues)
    expect(parsed.description).toBeNull()
    expect(parsed.location).toBeNull()
    expect(parsed.contact).toBeNull()
  })

  it('keeps non-empty optional text as trimmed strings', () => {
    const parsed = serviceFormSchema.parse({
      ...validValues,
      description: '  A gentle start  ',
    })
    expect(parsed.description).toBe('A gentle start')
  })

  it('clears BOTH options and optionsSelectMode when the list is empty', () => {
    const parsed = serviceFormSchema.parse({
      ...validValues,
      options: [],
      optionsSelectMode: 'multi',
    })
    // The pair is patched together in both directions (AGENTS.md): an
    // empty list means "no options", so the mode must not survive.
    expect(parsed.options).toBeNull()
    expect(parsed.optionsSelectMode).toBeNull()
  })

  it('keeps BOTH options and optionsSelectMode when the list is non-empty', () => {
    const parsed = serviceFormSchema.parse({
      ...validValues,
      options: ['Mat rental', 'Towel'],
      optionsSelectMode: 'multi',
    })
    expect(parsed.options).toEqual(['Mat rental', 'Towel'])
    expect(parsed.optionsSelectMode).toBe('multi')
  })

  it('rejects duplicate option labels', () => {
    const result = serviceFormSchema.safeParse({
      ...validValues,
      options: ['Mat', 'Mat'],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a non-numeric capacity mid-edit string', () => {
    const result = serviceFormSchema.safeParse({ ...validValues, defaultCapacity: '1e' })
    expect(result.success).toBe(false)
  })

  it('rejects an out-of-bounds maxSeatsPerBooking', () => {
    const tooBig = serviceFormSchema.safeParse({ ...validValues, maxSeatsPerBooking: '1001' })
    expect(tooBig.success).toBe(false)
    const zero = serviceFormSchema.safeParse({ ...validValues, maxSeatsPerBooking: '0' })
    expect(zero.success).toBe(false)
  })
})

describe('toServiceFormValues', () => {
  it('seeds from defaults when creating (no service passed)', () => {
    const values = toServiceFormValues()
    expect(values.defaultCapacity).toBe('10')
    expect(values.defaultDurationMinutes).toBe('60')
    // Solo-only by default, matching the DB column default.
    expect(values.maxSeatsPerBooking).toBe('1')
    expect(values.options).toEqual([])
    expect(values.optionsSelectMode).toBe('single')
    expect(values.photoUrl).toBeNull()
  })

  it('seeds from an existing service, numbers back to strings', () => {
    const service = {
      title: 'Evening Yoga',
      description: 'Wind-down flow',
      location: 'Studio 5',
      contact: null,
      defaultPrice: '12 EUR',
      defaultCapacity: 8,
      defaultDurationMinutes: 45,
      maxSeatsPerBooking: 2,
      options: ['Bolster'],
      optionsSelectMode: 'single',
      photoUrl: null,
    } as unknown as ServiceRecord
    const values = toServiceFormValues(service)
    expect(values.title).toBe('Evening Yoga')
    expect(values.defaultCapacity).toBe('8')
    expect(values.maxSeatsPerBooking).toBe('2')
    expect(values.options).toEqual(['Bolster'])
  })
})

describe('toCreateServiceInput', () => {
  it('drops null optionals (create takes absent keys, not nulls)', () => {
    const parsed = serviceFormSchema.parse(validValues)
    const input = toCreateServiceInput(parsed)
    expect(input).not.toHaveProperty('description')
    expect(input).not.toHaveProperty('location')
    expect(input).not.toHaveProperty('contact')
    expect(input).not.toHaveProperty('options')
    expect(input).not.toHaveProperty('optionsSelectMode')
    expect(input.title).toBe('Morning Yoga')
    expect(input.defaultCapacity).toBe(10)
  })

  it('keeps set optionals and the options pair together', () => {
    const parsed = serviceFormSchema.parse({
      ...validValues,
      location: 'Park',
      options: ['Mat'],
      optionsSelectMode: 'multi',
    })
    const input = toCreateServiceInput(parsed)
    expect(input.location).toBe('Park')
    expect(input.options).toEqual(['Mat'])
    expect(input.optionsSelectMode).toBe('multi')
  })
})
