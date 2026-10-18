// @vitest-environment node
/**
 * Realtime protocol integration tests (ADR-025) — two tiers, mirroring
 * the compose topology. Emit goes through the same `@upstash/realtime`
 * SDK call `/api/internal/revalidate` uses, so a wire-format drift
 * between emit and subscribe/history is impossible by construction;
 * what these tests pin is the *backend* parity (emulator ↔ real
 * Upstash) and the read paths the SSE handler serves.
 *
 * Tier 1 — `UPSTASH_RT_EMULATOR_URL` (docker-compose `redis-http` →
 * ghcr.io/coriou/up-redis; a `redis-http` service container in CI).
 * Answers the Upstash REST surface including SSE /subscribe; emit, then
 * read the stream back through @upstash/realtime `history()` — the same
 * reader the SSE route uses for replay.
 *
 * Tier 2 — `UPSTASH_RT_LIVE_URL/TOKEN` (dedicated Upstash instance):
 * subscribe first, then emit — the publish leg must deliver the event
 * live, with the stream entry id riding `message.id`/`cursor`.
 *
 * Each tier SKIPS when its backend is unreachable/absent (CI always has
 * the emulator; tier 2 needs repo secrets). Credentials are explicit
 * and named UPSTASH_RT_* on purpose: no fallback to
 * `realtimeRestConfig()`, so a dev `.env` carrying a *production*
 * Upstash `REDIS_URL` can never redirect these writes at prod.
 */
import {
  REALTIME_CHANNEL_SERVICE_PREFIX,
  REALTIME_EVENT_SLOT_OCCUPANCY,
  REALTIME_HISTORY_MAX_LENGTH,
  REALTIME_HISTORY_TTL_S,
  slotOccupancyEvent,
} from '@repo/contracts'
import { Realtime } from '@upstash/realtime'
import { Redis } from '@upstash/redis'
import { describe, expect, it } from 'vitest'

const EMULATOR_URL = (process.env.UPSTASH_RT_EMULATOR_URL ?? 'http://localhost:8080').replace(
  /\/$/,
  '',
)
const EMULATOR_TOKEN = process.env.UPSTASH_RT_EMULATOR_TOKEN ?? 'dev-upstash-token'
const LIVE = process.env.UPSTASH_RT_LIVE_URL
  ? { url: process.env.UPSTASH_RT_LIVE_URL, token: process.env.UPSTASH_RT_LIVE_TOKEN ?? '' }
  : null

// Mirrors server/realtime.ts — history bounds drive XADD trim + EXPIRE.
const schema = { slot: { occupancy: slotOccupancyEvent } }
const history = {
  maxLength: REALTIME_HISTORY_MAX_LENGTH,
  expireAfterSecs: REALTIME_HISTORY_TTL_S,
}
const EVENTS = [REALTIME_EVENT_SLOT_OCCUPANCY] as ['slot.occupancy']

let run = 0
function ids() {
  const suffix = `${Date.now()}-${run++}`
  return {
    channel: `${REALTIME_CHANNEL_SERVICE_PREFIX}svc-rt-${suffix}`,
    serviceId: `svc-rt-${suffix}`,
    organizerId: '01930000-0000-7000-8000-00000000cc01',
  }
}

/** The event payload the Python API would post — built here because
 * the route's only contract is `slotOccupancyEvent`, not a producer. */
function occupancy(i: ReturnType<typeof ids>) {
  return {
    serviceId: i.serviceId,
    organizerId: i.organizerId,
  }
}

async function restUp(url: string, token: string): Promise<boolean> {
  // CI service containers have no healthy-gate — retry briefly while
  // the emulator finishes booting instead of flaking on a cold start.
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const res = await fetch(`${url}/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(['PING']),
        signal: AbortSignal.timeout(3000),
      })
      if (res.ok) return true
    } catch {
      // fall through to the retry
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

type LiveMessage = { id: string; cursor: string; data: unknown }

/** The shared live-delivery scenario: subscribe first, then emit —
 * the publish leg must deliver the event with the stream id riding
 * `message.id`/`cursor` (the client's live-vs-replay dedupe key). */
async function expectLiveDelivery(redis: Redis) {
  const i = ids()
  const realtime = new Realtime({ redis, schema, history })

  let onData: ((m: LiveMessage) => void) | undefined
  const received = new Promise<LiveMessage>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('live event did not arrive within 15 s')),
      15_000,
    )
    onData = (m) => {
      clearTimeout(timer)
      resolve(m)
    }
  })
  const unsubscribe = await realtime.channel(i.channel).subscribe({
    events: EVENTS,
    history: false,
    onData: (m) => onData?.(m as unknown as LiveMessage),
  })

  try {
    await realtime.channel(i.channel).emit(REALTIME_EVENT_SLOT_OCCUPANCY, occupancy(i))
    const message = await received
    expect(slotOccupancyEvent.parse(message.data)).toMatchObject({
      serviceId: i.serviceId,
      organizerId: i.organizerId,
    })
    // The published `id` equals the XADD stream id.
    const entries = await redis.xrange(i.channel, '-', '+')
    const lastId = Object.keys(entries).at(-1)
    expect(message.id).toBe(lastId)
    expect(message.cursor).toBe(lastId)
  } finally {
    unsubscribe()
  }
}

describe('realtime protocol — tier 1 (redis-http emulator)', () => {
  it('sdk emit → @upstash/realtime history() replays the record', async (ctx) => {
    if (!(await restUp(EMULATOR_URL, EMULATOR_TOKEN))) {
      return ctx.skip('emulator unreachable — run `docker compose up redis-http`')
    }
    const i = ids()
    const redis = new Redis({ url: EMULATOR_URL, token: EMULATOR_TOKEN })
    await redis.del(i.channel)

    const realtime = new Realtime({ redis, schema, history })
    await realtime.channel(i.channel).emit(REALTIME_EVENT_SLOT_OCCUPANCY, occupancy(i))

    const replay = await realtime.channel(i.channel).history()
    const message = replay.at(-1)
    expect(message?.event).toBe(REALTIME_EVENT_SLOT_OCCUPANCY)
    expect(message?.channel).toBe(i.channel)
    // The replay path supplies the event id.
    expect(message?.id).toMatch(/^\d+-\d+$/)
    // history() already json-parsed the `data` field — parseable by the
    // same zod schema the client validates events with.
    expect(slotOccupancyEvent.parse(message?.data)).toMatchObject({
      serviceId: i.serviceId,
      organizerId: i.organizerId,
    })
    // EXPIRE half of the publish pipeline landed.
    const ttl = await redis.ttl(i.channel)
    expect(ttl).toBeGreaterThan(0)
  }, 45_000)

  it('subscribe → sdk emit → live event with the stream id', async (ctx) => {
    if (!(await restUp(EMULATOR_URL, EMULATOR_TOKEN))) {
      return ctx.skip('emulator unreachable — run `docker compose up redis-http`')
    }
    await expectLiveDelivery(new Redis({ url: EMULATOR_URL, token: EMULATOR_TOKEN }))
  }, 45_000)
})

describe('realtime protocol — tier 2 (dedicated Upstash)', () => {
  it('subscribe → sdk emit → live event with the stream id', async (ctx) => {
    if (!LIVE) {
      return ctx.skip('UPSTASH_RT_LIVE_URL/TOKEN absent — dedicated tier off')
    }
    await expectLiveDelivery(new Redis({ url: LIVE.url, token: LIVE.token }))
  }, 45_000)
})
