import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Channel authorization on GET /api/realtime (ADR-025): `service:*` is
 * public, `organizer:{id}` needs the matching session, the demo id is
 * refused, and one forbidden channel sinks the whole subscription.
 * `handle` is mocked — the test drives the middleware with the channel
 * list a `?channel=` query would produce.
 */

const mockAuth = vi.fn()
vi.mock('@/server/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}))

vi.mock('@/server/realtime', async (importOriginal) => ({
  // The real constant: the drift pin below compares it with the route's
  // segment-config literal. Only the Realtime instance is stubbed.
  ...(await importOriginal<typeof import('@/server/realtime')>()),
  realtime: { __stub: true },
}))

type Middleware = (args: { request: Request; channels: string[] }) => Promise<Response | void>

// vi.mock factories hoist above module scope — keep the capture in hoisted state.
const captured = vi.hoisted(() => ({ middleware: undefined as Middleware | undefined }))

// `handle` is stubbed; the rest of the package stays real, because the
// drift pin below imports the actual `@/server/realtime` (which builds a
// `Realtime` instance) to read its `maxDurationSecs` constant.
vi.mock('@upstash/realtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@upstash/realtime')>()),
  handle: (config: { middleware?: Middleware }) => {
    captured.middleware = config.middleware
    // Stand-in for the real SSE response.
    return () => new Response('stream', { status: 200 })
  },
}))

import { DEMO_ORGANIZER_ID } from '@repo/contracts'

import { REALTIME_MAX_DURATION_S } from '@/server/realtime'
import { GET, maxDuration } from './route'

function subscribe(channels: string[]) {
  const url = new URL('https://countmein.group/api/realtime')
  for (const channel of channels) url.searchParams.append('channel', channel)
  return GET(new Request(url))
}

async function middlewareStatus(channels: string[]): Promise<number> {
  const request = new Request('https://countmein.group/api/realtime')
  // `handle()` dedupes the ?channel= list before invoking middleware —
  // the harness mirrors that so the middleware sees what it sees live.
  const response = await captured.middleware!({ request, channels: [...new Set(channels)] })
  return response?.status ?? 200
}

beforeEach(() => {
  mockAuth.mockReset()
})

describe('GET /api/realtime — channel middleware', () => {
  it('allows a public service channel without a session', async () => {
    expect(await middlewareStatus(['service:svc-abc1'])).toBe(200)
    expect(mockAuth).not.toHaveBeenCalled()
  })

  it('requires a matching session for an organizer channel', async () => {
    mockAuth.mockResolvedValueOnce(null)
    expect(await middlewareStatus(['organizer:01930000-0000-7000-8000-00000000000a'])).toBe(403)

    mockAuth.mockResolvedValueOnce({ user: { id: '01930000-0000-7000-8000-00000000000b' } })
    expect(await middlewareStatus(['organizer:01930000-0000-7000-8000-00000000000a'])).toBe(403)

    mockAuth.mockResolvedValueOnce({ user: { id: '01930000-0000-7000-8000-00000000000a' } })
    expect(await middlewareStatus(['organizer:01930000-0000-7000-8000-00000000000a'])).toBe(200)
  })

  it('refuses the demo organizer channel outright', async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: DEMO_ORGANIZER_ID } })
    expect(await middlewareStatus([`organizer:${DEMO_ORGANIZER_ID}`])).toBe(403)
  })

  it('sinks the whole subscription when one channel is forbidden', async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: '01930000-0000-7000-8000-00000000000a' } })
    // The service channel is allowed — the foreign organizer is not.
    expect(
      await middlewareStatus([
        'service:svc-abc1',
        'organizer:01930000-0000-7000-8000-00000000000b',
      ]),
    ).toBe(403)
  })

  it('refuses unknown channel families', async () => {
    expect(await middlewareStatus(['global'])).toBe(403)
    expect(await middlewareStatus(['service:svc-abc1', 'presence:room-1'])).toBe(403)
  })

  it('refuses an empty channel id', async () => {
    expect(await middlewareStatus(['service:'])).toBe(403)
    expect(await middlewareStatus(['organizer:'])).toBe(403)
  })

  it('refuses malformed channel ids — a dead channel still costs a connection', async () => {
    expect(await middlewareStatus(['service:svc!!!'])).toBe(403)
    expect(await middlewareStatus(['organizer:not-a-uuid'])).toBe(403)
    expect(mockAuth).not.toHaveBeenCalled()
  })

  it('caps the channel fan-out — one Upstash connection per channel', async () => {
    const distinct = Array.from({ length: 11 }, (_, i) => `service:svc-abc${i}`)
    expect(await middlewareStatus(distinct)).toBe(400)
    // The cap counts UNIQUE channels: the handler dedupes before the
    // middleware, so repeated params are not a fan-out.
    expect(await middlewareStatus(Array(11).fill('service:svc-abc1'))).toBe(200)
  })

  it('is wired through handle() — GET reaches the SSE response', async () => {
    const res = await subscribe(['service:svc-abc1'])
    expect(res?.status).toBe(200)
    expect(captured.middleware).toBeDefined()
  })

  it('the segment maxDuration equals the Realtime instance budget', () => {
    // Next.js reads segment config statically, so the route spells the
    // number as a literal — this pins it against the constant feeding
    // `Realtime.maxDurationSecs` (a mismatch reconnects at the wrong
    // moment or gets the stream killed mid-read).
    expect(maxDuration).toBe(REALTIME_MAX_DURATION_S)
  })
})
