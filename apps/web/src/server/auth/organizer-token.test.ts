import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Unit tests for the organizer-auth JWT mint (architecture review fix #1).
 *
 * The token is the credential the Go API verifies (HS256, HKDF-derived key);
 * the derivation parameters are pinned by a golden vector on the Go side
 * (`pkg/auth/session_test.go`). Here we pin the TS side: shape, TTL, and the
 * no-secret → anonymous behavior.
 */

const SECRET = 'test-auth-secret-for-organizer-token'

describe('mintOrganizerAuth', () => {
  const originalSecret = process.env.AUTH_SECRET

  beforeEach(() => {
    process.env.AUTH_SECRET = SECRET
  })

  afterEach(() => {
    process.env.AUTH_SECRET = originalSecret
  })

  it('returns null without AUTH_SECRET (anonymous, not an error)', async () => {
    delete process.env.AUTH_SECRET
    const { mintOrganizerAuth } = await import('@/server/auth/organizer-token')
    expect(await mintOrganizerAuth('org-id', 'slug')).toBeNull()
  })

  it('mints a compact HS256 JWT with sub/slug/iat/exp', async () => {
    const { mintOrganizerAuth, ORGANIZER_AUTH_TTL_S } =
      await import('@/server/auth/organizer-token')
    const before = Math.floor(Date.now() / 1000)
    const token = await mintOrganizerAuth('01930000-0000-7000-8000-0000000000de', 'studio-demo')
    expect(token).not.toBeNull()
    const [header, payload, signature] = token!.split('.')
    expect(header).toBeTruthy()
    expect(payload).toBeTruthy()
    expect(signature).toBeTruthy()

    const decodedHeader = JSON.parse(atob(header!.replace(/-/g, '+').replace(/_/g, '/')))
    expect(decodedHeader).toEqual({ alg: 'HS256', typ: 'JWT' })

    const decoded = JSON.parse(atob(payload!.replace(/-/g, '+').replace(/_/g, '/')))
    expect(decoded.sub).toBe('01930000-0000-7000-8000-0000000000de')
    expect(decoded.slug).toBe('studio-demo')
    expect(decoded.iat).toBeGreaterThanOrEqual(before)
    expect(decoded.exp).toBe(decoded.iat + ORGANIZER_AUTH_TTL_S)
  })

  it('defaults slug to empty string when undefined', async () => {
    const { mintOrganizerAuth } = await import('@/server/auth/organizer-token')
    const token = await mintOrganizerAuth('org-id', undefined)
    const payload = JSON.parse(atob(token!.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')))
    expect(payload.slug).toBe('')
  })

  it('produces a deterministic signature for the same inputs', async () => {
    // Fake timers pin the second boundary: same iat/exp → byte-identical
    // token, no conditional assertion needed.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'))
    try {
      const { mintOrganizerAuth } = await import('@/server/auth/organizer-token')
      const a = await mintOrganizerAuth('org-id', 'slug')
      const b = await mintOrganizerAuth('org-id', 'slug')
      expect(a).toBe(b)
    } finally {
      vi.useRealTimers()
    }
  })

  it('changes the signature when the organizer differs', async () => {
    const { mintOrganizerAuth } = await import('@/server/auth/organizer-token')
    const a = await mintOrganizerAuth('organizer-a', 'slug')
    const b = await mintOrganizerAuth('organizer-b', 'slug')
    expect(a!.split('.')[2]).not.toBe(b!.split('.')[2])
  })
})
