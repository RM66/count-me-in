import { describe, expect, it } from 'vitest'

import type { ServiceRecord } from './service'
import {
  serviceFormSchema,
  toCreateServiceInput,
  toServiceFormValues,
  toUpdateServiceInput,
} from './service-form'

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

describe('toUpdateServiceInput', () => {
  const service = {
    title: 'Morning Yoga',
    description: null,
    location: null,
    contact: null,
    defaultPrice: '15 EUR',
    defaultCapacity: 10,
    defaultDurationMinutes: 60,
    maxSeatsPerBooking: 4,
    options: null,
    optionsSelectMode: null,
    photoUrl: 'https://media.example.com/cover.webp',
  } as unknown as ServiceRecord

  it('is empty when nothing changed — an unchanged photoUrl is not a media replacement', () => {
    const parsed = serviceFormSchema.parse({
      ...validValues,
      photoUrl: 'https://media.example.com/cover.webp',
    })
    expect(toUpdateServiceInput(parsed, service)).toEqual({})
  })

  it('emits only the changed fields', () => {
    const parsed = serviceFormSchema.parse({
      ...validValues,
      title: 'Evening Yoga',
      photoUrl: 'https://media.example.com/cover.webp',
    })
    expect(toUpdateServiceInput(parsed, service)).toEqual({ title: 'Evening Yoga' })
  })

  it('clears a column with null when the input was emptied', () => {
    const stored = { ...service, location: 'Studio 5' } as unknown as ServiceRecord
    const parsed = serviceFormSchema.parse({
      ...validValues,
      photoUrl: 'https://media.example.com/cover.webp',
    })
    expect(toUpdateServiceInput(parsed, stored)).toEqual({ location: null })
  })

  it('sends the options pair together when only the labels changed', () => {
    const stored = {
      ...service,
      options: ['Mat'],
      optionsSelectMode: 'single',
    } as unknown as ServiceRecord
    const parsed = serviceFormSchema.parse({
      ...validValues,
      options: ['Mat', 'Towel'],
      optionsSelectMode: 'single',
      photoUrl: 'https://media.example.com/cover.webp',
    })
    expect(toUpdateServiceInput(parsed, stored)).toEqual({
      options: ['Mat', 'Towel'],
      optionsSelectMode: 'single',
    })
  })

  it('clears the pair together when the option list was emptied', () => {
    const stored = {
      ...service,
      options: ['Mat'],
      optionsSelectMode: 'multi',
    } as unknown as ServiceRecord
    const parsed = serviceFormSchema.parse({
      ...validValues,
      photoUrl: 'https://media.example.com/cover.webp',
    })
    expect(toUpdateServiceInput(parsed, stored)).toEqual({
      options: null,
      optionsSelectMode: null,
    })
  })
})
