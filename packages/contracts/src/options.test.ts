import { describe, expect, it } from 'vitest'

import { optionsList } from './options'

describe('optionsList', () => {
  it('rejects an empty array', () => {
    expect(optionsList.safeParse([]).success).toBe(false)
  })

  it('rejects more than 50 options', () => {
    const many = Array.from({ length: 51 }, (_, i) => `option-${i}`)
    expect(optionsList.safeParse(many).success).toBe(false)
  })

  it('rejects duplicates', () => {
    expect(optionsList.safeParse(['A', 'A']).success).toBe(false)
  })

  it('accepts a valid unique list', () => {
    expect(optionsList.safeParse(['Yoga mat', 'Towel', 'Water bottle']).success).toBe(true)
  })
})
