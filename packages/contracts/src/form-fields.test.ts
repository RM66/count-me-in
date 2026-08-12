import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { numericText, optionalText } from './form-fields'

describe('optionalText', () => {
  const schema = optionalText(z.string().min(3).max(10))

  it('transforms empty string to null', () => {
    const result = schema.safeParse('')
    expect(result.success).toBe(true)
    expect(result.data).toBeNull()
  })

  it('returns a valid string as-is', () => {
    const result = schema.safeParse('hello')
    expect(result.success).toBe(true)
    expect(result.data).toBe('hello')
  })

  it('rejects an invalid string', () => {
    const result = schema.safeParse('ab') // min 3
    expect(result.success).toBe(false)
  })
})

describe('numericText', () => {
  const schema = numericText(z.number().int().min(1).max(100), 'Capacity')

  it('rejects an empty string with a "required" message', () => {
    const result = schema.safeParse('')
    expect(result.success).toBe(false)
  })

  it('transforms a numeric string to a number', () => {
    const result = schema.safeParse('42')
    expect(result.success).toBe(true)
    expect(result.data).toBe(42)
  })

  it('rejects a non-numeric string', () => {
    const result = schema.safeParse('abc')
    expect(result.success).toBe(false)
  })

  it('rejects a value below the minimum', () => {
    const result = schema.safeParse('0')
    expect(result.success).toBe(false)
  })

  it('rejects a value above the maximum', () => {
    const result = schema.safeParse('101')
    expect(result.success).toBe(false)
  })
})
