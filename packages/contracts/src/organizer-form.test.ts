import { describe, expect, it } from 'vitest'

import type { OrganizerProfile } from './organizer'
import {
  organizerFormSchema,
  toOrganizerFormValues,
  toOrganizerProfilePatch,
} from './organizer-form'

// the form schema is the seam between controlled string inputs and the
// merge-patch update contract. The load-bearing rules: `''` collapses to
// `null` (clear the column), and only touched keys may leave — an absent
// key means "keep", so a full-field submit would null stale columns.

const validValues = {
  name: 'My Studio',
  slug: 'my-studio',
  description: '',
  contact: '',
  timezone: 'Europe/Belgrade',
  location: '',
}

describe('organizerFormSchema', () => {
  it("collapses '' to null for the clearable fields", () => {
    const parsed = organizerFormSchema.parse(validValues)
    expect(parsed.description).toBeNull()
    expect(parsed.contact).toBeNull()
    expect(parsed.location).toBeNull()
  })

  it('trims kept values', () => {
    const parsed = organizerFormSchema.parse({
      ...validValues,
      name: '  Studio  ',
      location: '  Hall 1 ',
    })
    expect(parsed.name).toBe('Studio')
    expect(parsed.location).toBe('Hall 1')
  })

  it('rejects a slug that violates the shape or the reserved list', () => {
    expect(organizerFormSchema.safeParse({ ...validValues, slug: 'ab' }).success).toBe(false)
    expect(organizerFormSchema.safeParse({ ...validValues, slug: 'demo' }).success).toBe(false)
  })

  it('rejects a non-IANA timezone', () => {
    expect(
      organizerFormSchema.safeParse({ ...validValues, timezone: 'Mars/Olympus' }).success,
    ).toBe(false)
  })
})

describe('toOrganizerFormValues', () => {
  it("seeds nullable columns as ''", () => {
    const values = toOrganizerFormValues({
      name: 'My Studio',
      slug: 'my-studio',
      description: null,
      contact: null,
      timezone: 'Europe/Belgrade',
      location: null,
    } as OrganizerProfile)
    expect(values).toEqual({
      name: 'My Studio',
      slug: 'my-studio',
      description: '',
      contact: '',
      timezone: 'Europe/Belgrade',
      location: '',
    })
  })
})

describe('toOrganizerProfilePatch', () => {
  it('emits only touched keys — absent keeps the column', () => {
    const parsed = organizerFormSchema.parse(validValues)
    expect(toOrganizerProfilePatch(parsed, { name: true })).toEqual({ name: 'My Studio' })
  })

  it('sends null for a cleared field — clears the column', () => {
    const parsed = organizerFormSchema.parse(validValues)
    expect(toOrganizerProfilePatch(parsed, { contact: true })).toEqual({ contact: null })
  })

  it('an untouched set produces an empty patch', () => {
    const parsed = organizerFormSchema.parse(validValues)
    expect(toOrganizerProfilePatch(parsed, {})).toEqual({})
  })
})
