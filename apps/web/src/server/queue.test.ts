import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { publishBookingCancelled, publishBookingCreated } from './queue'

// The QStash client is an HTTP wrapper — mocked here so the tests pin the
// publish contract (destination URL, per-recipient fan-out, retries) without
// network access. One shared `publishJSON` across instances because the
// publisher builds a client per publish call.
const publishJSON = vi.fn().mockResolvedValue({ messageId: 'msg_x' })

vi.mock('@upstash/qstash', () => ({
  Client: vi.fn().mockImplementation(() => ({ publishJSON })),
}))

const { Client } = await import('@upstash/qstash')

const BOOKING_ID = '01930000-0000-7000-8000-000000000001'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.QSTASH_TOKEN = 'test-token'
  process.env.APP_URL = 'https://countmein.group/'
})

afterEach(() => {
  delete process.env.QSTASH_TOKEN
})

describe('publishBookingCreated', () => {
  it('fans out to one job per recipient with the receiver route as destination', async () => {
    await publishBookingCreated(BOOKING_ID)

    expect(publishJSON.mock.calls).toHaveLength(2)

    const [organizerArgs, guestArgs] = publishJSON.mock.calls
    expect(organizerArgs?.[0]).toMatchObject({
      url: 'https://countmein.group/api/jobs/booking.created',
      retries: 5,
      body: { bookingId: BOOKING_ID, recipient: 'organizer' },
    })
    expect(guestArgs?.[0]).toMatchObject({
      body: { bookingId: BOOKING_ID, recipient: 'guest' },
    })
  })

  it('does not construct a client in dev without a token', async () => {
    delete process.env.QSTASH_TOKEN

    await publishBookingCreated(BOOKING_ID)

    expect(Client).not.toHaveBeenCalled()
  })

  it('never rejects — a publish failure must not fail a committed booking', async () => {
    publishJSON.mockRejectedValue(new Error('Upstash unreachable'))

    await expect(publishBookingCreated(BOOKING_ID)).resolves.toBeUndefined()
  })
})

describe('publishBookingCancelled', () => {
  it('publishes one job recording the actor', async () => {
    await publishBookingCancelled(BOOKING_ID, 'guest')

    expect(publishJSON.mock.calls).toHaveLength(1)
    expect(publishJSON.mock.calls[0]![0]).toMatchObject({
      url: 'https://countmein.group/api/jobs/booking.cancelled',
      retries: 5,
      body: { bookingId: BOOKING_ID, cancelledBy: 'guest' },
    })
  })
})
