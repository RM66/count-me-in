import { describe, expect, it } from 'vitest'

import { queryKeys } from './keys'

describe('queryKeys.organizer', () => {
  it('has a stable "me" key', () => {
    expect(queryKeys.organizer.me).toEqual(['organizer', 'me'])
  })
})

describe('queryKeys — referential stability', () => {
  it('returns the same reference for static keys', () => {
    expect(queryKeys.organizer.me).toBe(queryKeys.organizer.me)
  })
})
