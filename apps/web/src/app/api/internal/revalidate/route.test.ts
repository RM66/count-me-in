import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Unit tests for the Python→Next.js cache-invalidation endpoint
 * (ADR-023): the internal-secret auth, the payload contract,
 * and the tag allowlist. `revalidateTag` is mocked — what matters is
 * which tags reach it, not Next's cache internals.
 */
import { derivedInternalSecret } from '@/server/internal-api'

const revalidateTagMock = vi.fn()

vi.mock('next/cache', () => ({
  revalidateTag: revalidateTagMock,
}))

// The emit is mocked at the channel seam — the tests pin the channel
// fan-out and the fail-open contract, not the SDK's internals.
const emitMock = vi.fn()
const channelMock = vi.fn((channel: string) => ({ emit: emitMock, channel }))
const configured = vi.hoisted(() => ({ value: true }))

vi.mock('@/server/realtime', () => ({
  realtime: { channel: channelMock },
  get realtimeConfigured() {
    return configured.value
  },
}))

// internal-api → api-origin imports next/headers, which throws outside
// a Next runtime; the test never resolves an origin, so a bare stub
// suffices.
vi.mock('next/headers', () => ({ headers: vi.fn() }))

const AUTH_SECRET = 'revalidate-route-test-secret'

const OCCUPANCY = {
  serviceId: 'svc-abc123',
  organizerId: '01930000-0000-7000-8000-0000000000aa',
}

function secretHeader(): Record<string, string> {
  return { 'x-internal-secret': derivedInternalSecret(AUTH_SECRET) }
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/internal/revalidate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('POST /api/internal/revalidate', () => {
  beforeEach(() => {
    vi.resetModules()
    revalidateTagMock.mockReset()
    emitMock.mockReset().mockResolvedValue(undefined)
    channelMock.mockClear()
    configured.value = true
    vi.stubEnv('AUTH_SECRET', AUTH_SECRET)
  })

  it('rejects a missing secret with 401', async () => {
    const { POST } = await import('./route')
    const res = await POST(post({ tags: ['public-sitemap'] }))
    expect(res.status).toBe(401)
    expect(revalidateTagMock).not.toHaveBeenCalled()
  })

  it('rejects a wrong secret with 401', async () => {
    const { POST } = await import('./route')
    const res = await POST(post({ tags: ['public-sitemap'] }, { 'x-internal-secret': 'forged' }))
    expect(res.status).toBe(401)
    expect(revalidateTagMock).not.toHaveBeenCalled()
  })

  it('rejects when AUTH_SECRET is unconfigured', async () => {
    vi.stubEnv('AUTH_SECRET', '')
    const { POST } = await import('./route')
    const res = await POST(post({ tags: ['public-sitemap'] }, secretHeader()))
    expect(res.status).toBe(401)
  })

  it('revalidates each allowed tag', async () => {
    const { POST } = await import('./route')
    const res = await POST(
      post(
        { tags: ['public-organizer:acme', 'public-service:abc123', 'public-sitemap'] },
        secretHeader(),
      ),
    )
    expect(res.status).toBe(200)
    expect(revalidateTagMock.mock.calls.map((c) => c[0])).toEqual([
      'public-organizer:acme',
      'public-service:abc123',
      'public-sitemap',
    ])
  })

  it('rejects a tag outside the public-* allowlist', async () => {
    const { POST } = await import('./route')
    const res = await POST(post({ tags: ['public-sitemap', 'cabinet-services'] }, secretHeader()))
    expect(res.status).toBe(400)
    expect(revalidateTagMock).not.toHaveBeenCalled()
  })

  it('rejects malformed payloads', async () => {
    const { POST } = await import('./route')
    for (const body of ['not json', {}, { tags: [] }, { tags: [42] }, { tags: 'x' }, null]) {
      const res = await POST(post(body, secretHeader()))
      expect(res.status).toBe(400)
    }
    expect(revalidateTagMock).not.toHaveBeenCalled()
  })

  it('emits a valid occupancy payload to the service and organizer channels', async () => {
    const { POST } = await import('./route')
    const res = await POST(
      post({ tags: ['public-service:abc'], occupancy: OCCUPANCY }, secretHeader()),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ emitted: true })
    expect(channelMock.mock.calls.map((c) => c[0])).toEqual([
      `service:${OCCUPANCY.serviceId}`,
      `organizer:${OCCUPANCY.organizerId}`,
    ])
    expect(emitMock).toHaveBeenCalledTimes(2)
    expect(emitMock).toHaveBeenCalledWith('slot.occupancy', OCCUPANCY)
  })

  it('reports emitted: false without emitting when realtime is unconfigured', async () => {
    configured.value = false
    const { POST } = await import('./route')
    const res = await POST(
      post({ tags: ['public-service:abc'], occupancy: OCCUPANCY }, secretHeader()),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ revalidated: true, emitted: false })
    expect(channelMock).not.toHaveBeenCalled()
  })

  it('still revalidates when the emit fails — realtime is fail-open', async () => {
    emitMock.mockRejectedValue(new Error('upstash down'))
    const { POST } = await import('./route')
    const res = await POST(
      post({ tags: ['public-service:abc'], occupancy: OCCUPANCY }, secretHeader()),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ revalidated: true, emitted: false })
    expect(revalidateTagMock).toHaveBeenCalledWith('public-service:abc', 'max')
  })

  it('revalidates tags first and rejects a malformed occupancy payload with 400', async () => {
    const { POST } = await import('./route')
    const res = await POST(
      post({ tags: ['public-sitemap'], occupancy: { serviceId: 'bad' } }, secretHeader()),
    )
    expect(res.status).toBe(400)
    expect(revalidateTagMock).toHaveBeenCalledWith('public-sitemap', 'max')
    expect(emitMock).not.toHaveBeenCalled()
  })

  it('never emits for the demo organizer — revalidation still runs', async () => {
    const { POST } = await import('./route')
    const res = await POST(
      post(
        {
          tags: ['public-organizer:demo'],
          occupancy: { ...OCCUPANCY, organizerId: '01930000-0000-7000-8000-0000000000de' },
        },
        secretHeader(),
      ),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ emitted: false })
    expect(emitMock).not.toHaveBeenCalled()
  })
})
