import { describe, expect, it } from 'vitest'

import {
  REALTIME_CHANNEL_ORGANIZER_PREFIX,
  REALTIME_CHANNEL_SERVICE_PREFIX,
  REALTIME_EVENT_SLOT_OCCUPANCY,
  REALTIME_HISTORY_MAX_LENGTH,
  REALTIME_HISTORY_TTL_S,
  realtimeChannels,
  slotOccupancyEvent,
} from './realtime'

const VALID_EVENT = {
  serviceId: 'svc-abc123',
  organizerId: '01930000-0000-7000-8000-000000000002',
}

describe('slotOccupancyEvent', () => {
  it('parses a valid event', () => {
    const parsed = slotOccupancyEvent.safeParse(VALID_EVENT)
    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual(VALID_EVENT)
  })

  it('rejects a malformed serviceId or organizerId', () => {
    expect(slotOccupancyEvent.safeParse({ ...VALID_EVENT, serviceId: 'bad' }).success).toBe(false)
    expect(
      slotOccupancyEvent.safeParse({ ...VALID_EVENT, organizerId: 'not-a-uuid' }).success,
    ).toBe(false)
  })
})

describe('realtimeChannels', () => {
  it('builds the public service channel name', () => {
    expect(realtimeChannels.service('svc-abc123')).toBe(
      `${REALTIME_CHANNEL_SERVICE_PREFIX}svc-abc123`,
    )
  })

  it('builds the private organizer channel name', () => {
    expect(realtimeChannels.organizer('01930000-0000-7000-8000-000000000002')).toBe(
      `${REALTIME_CHANNEL_ORGANIZER_PREFIX}01930000-0000-7000-8000-000000000002`,
    )
  })
})

describe('event name and retention', () => {
  it('pins the wire constants the emit and subscribe paths must agree on', () => {
    expect(REALTIME_EVENT_SLOT_OCCUPANCY).toBe('slot.occupancy')
    expect(REALTIME_HISTORY_MAX_LENGTH).toBe(200)
    expect(REALTIME_HISTORY_TTL_S).toBe(86_400)
  })
})
