import { describe, expect, it } from 'vitest'

import { bookingCancelledJob, bookingCreatedJob, cancelNotificationRecipient } from './jobs'

describe('cancelNotificationRecipient', () => {
  it('returns "organizer" when cancelled by the guest', () => {
    expect(cancelNotificationRecipient('guest')).toBe('organizer')
  })

  it('returns "guest" when cancelled by the organizer', () => {
    expect(cancelNotificationRecipient('organizer')).toBe('guest')
  })
})

describe('bookingCreatedJob', () => {
  it('parses a valid payload', () => {
    const result = bookingCreatedJob.safeParse({
      bookingId: '01930000-0000-7000-8000-000000000001',
      recipient: 'organizer',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a missing recipient', () => {
    const result = bookingCreatedJob.safeParse({
      bookingId: '01930000-0000-7000-8000-000000000001',
    })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid recipient', () => {
    const result = bookingCreatedJob.safeParse({
      bookingId: '01930000-0000-7000-8000-000000000001',
      recipient: 'admin',
    })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid bookingId', () => {
    const result = bookingCreatedJob.safeParse({
      bookingId: 'not-a-uuid',
      recipient: 'guest',
    })
    expect(result.success).toBe(false)
  })
})

describe('bookingCancelledJob', () => {
  it('parses a valid payload', () => {
    const result = bookingCancelledJob.safeParse({
      bookingId: '01930000-0000-7000-8000-000000000001',
      cancelledBy: 'guest',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an invalid cancelledBy', () => {
    const result = bookingCancelledJob.safeParse({
      bookingId: '01930000-0000-7000-8000-000000000001',
      cancelledBy: 'system',
    })
    expect(result.success).toBe(false)
  })
})
