import { describe, expect, it } from 'vitest'

import { buildSelectedOptionsSchema, optionsList } from './options'

describe('buildSelectedOptionsSchema', () => {
  it('normalizes empty selection to null when service has no options', () => {
    const schema = buildSelectedOptionsSchema({ options: null, optionsSelectMode: null })
    expect(schema.safeParse(undefined).data).toBeNull()
    expect(schema.safeParse([]).data).toBeNull()
  })

  it('rejects a non-empty selection when service has no options', () => {
    const schema = buildSelectedOptionsSchema({ options: null, optionsSelectMode: null })
    const result = schema.safeParse(['Yoga mat'])
    expect(result.success).toBe(false)
  })

  it('accepts a single selection in single mode', () => {
    const schema = buildSelectedOptionsSchema({
      options: ['Beginner', 'Intermediate'],
      optionsSelectMode: 'single',
    })
    const result = schema.safeParse(['Beginner'])
    expect(result.success).toBe(true)
    expect(result.data).toEqual(['Beginner'])
  })

  it('rejects more than one selection in single mode', () => {
    const schema = buildSelectedOptionsSchema({
      options: ['Beginner', 'Intermediate'],
      optionsSelectMode: 'single',
    })
    const result = schema.safeParse(['Beginner', 'Intermediate'])
    expect(result.success).toBe(false)
  })

  it('accepts any subset in multi mode', () => {
    const schema = buildSelectedOptionsSchema({
      options: ['A', 'B', 'C'],
      optionsSelectMode: 'multi',
    })
    expect(schema.safeParse(['A', 'C']).success).toBe(true)
    expect(schema.safeParse(['A', 'B', 'C']).success).toBe(true)
  })

  it('rejects duplicate selections', () => {
    const schema = buildSelectedOptionsSchema({
      options: ['A', 'B'],
      optionsSelectMode: 'multi',
    })
    const result = schema.safeParse(['A', 'A'])
    expect(result.success).toBe(false)
  })

  it('rejects an option not offered by the service', () => {
    const schema = buildSelectedOptionsSchema({
      options: ['A', 'B'],
      optionsSelectMode: 'multi',
    })
    const result = schema.safeParse(['C'])
    expect(result.success).toBe(false)
  })

  it('normalizes empty array to null even when service has options', () => {
    const schema = buildSelectedOptionsSchema({
      options: ['A', 'B'],
      optionsSelectMode: 'multi',
    })
    expect(schema.safeParse([]).data).toBeNull()
  })
})

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
