import { describe, expect, it } from 'vitest'

import { queryKeys } from './keys'

describe('queryKeys.organizer', () => {
  it('has a stable "me" key', () => {
    expect(queryKeys.organizer.me).toEqual(['organizer', 'me'])
  })
})

describe('queryKeys.services', () => {
  it('has a stable "all" key', () => {
    expect(queryKeys.services.all).toEqual(['services'])
  })

  it('creates a detail key with the service id', () => {
    expect(queryKeys.services.detail('svc-1')).toEqual(['services', 'svc-1'])
  })

  it('detail key is a prefix of the all key hierarchy', () => {
    // services.all is ['services'], services.detail('x') is ['services', 'x']
    // so invalidating ['services'] should also invalidate ['services', 'x']
    const all = queryKeys.services.all
    const detail = queryKeys.services.detail('svc-1')
    expect(detail.slice(0, all.length)).toEqual(all)
  })
})

describe('queryKeys.slots', () => {
  it('has a stable "all" key', () => {
    expect(queryKeys.slots.all).toEqual(['slots'])
  })

  it('creates a detail key with the slot id', () => {
    expect(queryKeys.slots.detail('slot-1')).toEqual(['slots', 'slot-1'])
  })
})

describe('queryKeys.bookings', () => {
  it('has a stable "all" key', () => {
    expect(queryKeys.bookings.all).toEqual(['bookings'])
  })

  it('creates a guest key keyed by messengerId', () => {
    expect(queryKeys.bookings.guest('tg-123')).toEqual(['bookings', 'guest', 'tg-123'])
  })

  it('guest keys are distinct per messengerId', () => {
    expect(queryKeys.bookings.guest('user-a')).not.toEqual(queryKeys.bookings.guest('user-b'))
  })
})

describe('queryKeys — referential stability', () => {
  it('returns the same reference for static keys', () => {
    expect(queryKeys.organizer.me).toBe(queryKeys.organizer.me)
    expect(queryKeys.services.all).toBe(queryKeys.services.all)
  })
})
