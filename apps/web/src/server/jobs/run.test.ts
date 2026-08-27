import { QUEUE_BOOKING_CANCELLED, QUEUE_BOOKING_CREATED } from '@repo/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { InvalidJobPayloadError, runJob, UnknownJobQueueError } from './run'
import { TelegramTransientError, TelegramUnreachableError } from './telegram/client'

// Handlers are mocked: their own behaviour is covered by the Telegram client /
// template tests; what matters here is the dispatch contract — validation and
// retry classification.
vi.mock('./booking-created', () => ({ handleBookingCreated: vi.fn() }))
vi.mock('./booking-cancelled', () => ({ handleBookingCancelled: vi.fn() }))
vi.mock('./demo-refresh', () => ({ refreshDemoSeed: vi.fn() }))
vi.mock('./env', () => ({ readJobsEnv: vi.fn().mockReturnValue({}) }))

const { handleBookingCreated } = await import('./booking-created')
const { handleBookingCancelled } = await import('./booking-cancelled')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('runJob — queue routing', () => {
  it('rejects with UnknownJobQueueError for a foreign queue name', async () => {
    await expect(runJob('not.a-queue', {})).rejects.toBeInstanceOf(UnknownJobQueueError)
  })

  it('runs booking.created for a valid payload', async () => {
    const job = { bookingId: '01930000-0000-7000-8000-000000000001', recipient: 'guest' }

    await runJob(QUEUE_BOOKING_CREATED, job)

    expect(handleBookingCreated).toHaveBeenCalledWith(expect.anything(), job)
  })

  it('runs booking.cancelled for a valid payload', async () => {
    const job = { bookingId: '01930000-0000-7000-8000-000000000001', cancelledBy: 'guest' }

    await runJob(QUEUE_BOOKING_CANCELLED, job)

    expect(handleBookingCancelled).toHaveBeenCalledWith(expect.anything(), job)
  })
})

describe('runJob — payload validation', () => {
  it('rejects with InvalidJobPayloadError when the body misses required fields', async () => {
    await expect(runJob(QUEUE_BOOKING_CREATED, { bookingId: 'x' })).rejects.toBeInstanceOf(
      InvalidJobPayloadError,
    )
    expect(handleBookingCreated).not.toHaveBeenCalled()
  })

  it('rejects with InvalidJobPayloadError when the body is not an object', async () => {
    await expect(runJob(QUEUE_BOOKING_CANCELLED, 'nope')).rejects.toBeInstanceOf(
      InvalidJobPayloadError,
    )
  })
})

describe('runJob — retry classification', () => {
  it('resolves when the recipient is unreachable — the delivery must complete', async () => {
    const unreachable = new TelegramUnreachableError('123', 'bot was blocked')
    vi.mocked(handleBookingCreated).mockRejectedValueOnce(unreachable)

    await expect(
      runJob(QUEUE_BOOKING_CREATED, {
        bookingId: '01930000-0000-7000-8000-000000000001',
        recipient: 'guest',
      }),
    ).resolves.toBeUndefined()
  })

  it('rethrows transient failures so the route answers 500 and QStash retries', async () => {
    vi.mocked(handleBookingCancelled).mockRejectedValueOnce(
      new TelegramTransientError('Telegram 429'),
    )

    await expect(
      runJob(QUEUE_BOOKING_CANCELLED, {
        bookingId: '01930000-0000-7000-8000-000000000001',
        cancelledBy: 'organizer',
      }),
    ).rejects.toBeInstanceOf(TelegramTransientError)
  })

  it('rethrows unexpected errors', async () => {
    vi.mocked(handleBookingCancelled).mockRejectedValueOnce(new Error('db down'))

    await expect(
      runJob(QUEUE_BOOKING_CANCELLED, {
        bookingId: '01930000-0000-7000-8000-000000000001',
        cancelledBy: 'guest',
      }),
    ).rejects.toThrow('db down')
  })
})
