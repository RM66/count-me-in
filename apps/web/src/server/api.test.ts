import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Unit tests for `goApiFetch` — the server-action half of the write wire.
 * The Auth.js session and the JWT mint are mocked: what matters here is the
 * contract with the Go API (origin resolution, header forwarding, anonymous
 * pass-through).
 */

const fetchMock = vi.fn()

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ host: 'countmein.group' })),
}))

vi.mock('@/server/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'org-1', slug: 'my-slug' } })),
}))

vi.mock('@/server/auth/organizer-token', () => ({
  ORGANIZER_AUTH_HEADER: 'x-organizer-auth',
  mintOrganizerAuth: vi.fn(async () => 'minted.jwt.token'),
}))

describe('goApiFetch', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
    // NODE_ENV is typed read-only; the runtime allows the assignment.
    vi.stubEnv('NODE_ENV', 'development')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('targets GO_API_URL in dev', async () => {
    vi.stubEnv('GO_API_URL', 'http://127.0.0.1:9999/')
    const { goApiFetch } = await import('@/server/api')
    await goApiFetch('/api/services')
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:9999/api/services',
      expect.objectContaining({ headers: expect.any(Headers) }),
    )
  })

  it('derives the origin from the Host header in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { goApiFetch } = await import('@/server/api')
    await goApiFetch('/api/services')
    const [url] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('https://countmein.group/api/services')
  })

  it('forwards the minted organizer-auth header for a signed-in session', async () => {
    const { goApiFetch } = await import('@/server/api')
    await goApiFetch('/api/services')
    const init = fetchMock.mock.calls[0]![1] as RequestInit
    expect((init.headers as Headers).get('x-organizer-auth')).toBe('minted.jwt.token')
  })

  it('sends no organizer-auth header for an anonymous session', async () => {
    const { auth } = await import('@/server/auth')
    vi.mocked(auth).mockResolvedValueOnce(null as never)
    const { goApiFetch } = await import('@/server/api')
    await goApiFetch('/api/services')
    const init = fetchMock.mock.calls[0]![1] as RequestInit
    expect((init.headers as Headers).get('x-organizer-auth')).toBeNull()
  })

  it('preserves caller headers and method/body', async () => {
    const { goApiFetch } = await import('@/server/api')
    await goApiFetch('/api/services', {
      method: 'POST',
      body: '{"title":"x"}',
      headers: { 'content-type': 'application/json' },
    })
    const init = fetchMock.mock.calls[0]![1] as RequestInit
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{"title":"x"}')
    expect((init.headers as Headers).get('content-type')).toBe('application/json')
  })
})
