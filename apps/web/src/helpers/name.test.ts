import { describe, expect, it } from 'vitest'

import { initials } from './name'

describe('initials', () => {
  it('extracts initials from a single name', () => {
    expect(initials('John')).toBe('J')
  })

  it('extracts initials from two names', () => {
    expect(initials('Jane Doe')).toBe('JD')
  })

  it('extracts only the first two words from three names', () => {
    expect(initials('John Ronald Tolkien')).toBe('JR')
  })

  it('returns uppercase', () => {
    expect(initials('john doe')).toBe('JD')
  })

  it('returns empty string for empty input', () => {
    expect(initials('')).toBe('')
  })

  it('handles extra whitespace between names', () => {
    expect(initials('Jane   Doe')).toBe('JD')
  })
})
