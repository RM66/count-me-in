import { describe, expect, it } from 'vitest'

import { queryKeys } from './keys'

describe('queryKeys.organizer', () => {
  it('has a stable "me" key', () => {
    expect(queryKeys.organizer.me).toEqual(['organizer', 'me'])
  })
})

describe('queryKeys.publicService', () => {
  it('builds hierarchical keys under public-service', () => {
    expect(queryKeys.publicService.all).toEqual(['public-service'])
    expect(queryKeys.publicService.detail('svc-1')).toEqual(['public-service', 'svc-1'])
  })
})

describe('queryKeys — referential stability', () => {
  it('returns the same reference for static keys', () => {
    expect(queryKeys.organizer.me).toBe(queryKeys.organizer.me)
    expect(queryKeys.publicService.all).toBe(queryKeys.publicService.all)
  })
})
