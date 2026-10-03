import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Unit tests for the Python→Next.js cache-invalidation endpoint
 * (ADR-023 Phase 3): the internal-secret auth, the payload contract,
 * and the tag allowlist. `revalidateTag` is mocked — what matters is
 * which tags reach it, not Next's cache internals.
 */
import { derivedInternalSecret } from '@/server/internal-api'

const revalidateTagMock = vi.fn()

vi.mock('next/cache', () => ({
  revalidateTag: revalidateTagMock,
}))

// internal-api → api-origin imports next/headers, which throws outside
// a Next runtime; the test never resolves an origin, so a bare stub
// suffices.
vi.mock('next/headers', () => ({ headers: vi.fn() }))

const AUTH_SECRET = 'revalidate-route-test-secret'

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
    for (const body of ['not json', {}, { tags: [] }, { tags: [42] }, { tags: 'x' }]) {
      const res = await POST(post(body, secretHeader()))
      expect(res.status).toBe(400)
    }
    expect(revalidateTagMock).not.toHaveBeenCalled()
  })
})
