import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { derivedInternalSecret } from '@/server/internal-api'

import 'server-only'

vi.mock('next/headers', () => ({ headers: vi.fn() }))

vi.mock('@/server/api-origin', () => ({
  resolveApiOrigin: vi.fn(async () => 'http://api.test'),
}))

/**
 * Golden-vector parity for the internal service secret.
 *
 * The expected value is produced by the Python implementation
 * (`countmein/auth/internal.py::derived_internal_secret`); any drift in
 * salt, info string, or extract-expand order breaks Auth.js lookups with
 * a 401, so the vector — not a re-implementation — is the assertion.
 */

describe('derivedInternalSecret', () => {
  it('matches the Python golden vector', () => {
    expect(derivedInternalSecret('test-auth-secret')).toBe(
      '73b1b535eb4ded0b2f67951c5f9baf63b26be71360d8401d8a49d2a24c1dd106',
    )
  })

  it('is deterministic and secret-sensitive', () => {
    expect(derivedInternalSecret('test-auth-secret')).toBe(
      derivedInternalSecret('test-auth-secret'),
    )
    expect(derivedInternalSecret('other-secret')).not.toBe(
      derivedInternalSecret('test-auth-secret'),
    )
  })

  it('uses a purpose-bound info string, not the raw HMAC of the secret', async () => {
    const { createHmac } = await import('node:crypto')
    expect(derivedInternalSecret('same-secret')).not.toBe(
      createHmac('sha256', 'countmein').update('same-secret', 'utf8').digest('hex'),
    )
  })
})

const organizerRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Anna',
  slug: 'yoga-anna',
  photoUrl: null,
}

describe('internalSecretHeaders', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('mints the derived secret header when AUTH_SECRET is set', async () => {
    vi.stubEnv('AUTH_SECRET', 'test-auth-secret')
    const { internalSecretHeaders } = await import('@/server/internal-api')
    expect(internalSecretHeaders()).toEqual({
      'x-internal-secret': '73b1b535eb4ded0b2f67951c5f9baf63b26be71360d8401d8a49d2a24c1dd106',
    })
  })

  it('returns no header when AUTH_SECRET is unconfigured', async () => {
    vi.stubEnv('AUTH_SECRET', '')
    const { internalSecretHeaders } = await import('@/server/internal-api')
    expect(internalSecretHeaders()).toEqual({})
  })
})

describe('getInternalOrganizer', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ organizer: organizerRecord }), { status: 200 }),
    )
    vi.stubEnv('AUTH_SECRET', 'test-auth-secret')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('returns null without an AUTH_SECRET — lookup cannot authenticate', async () => {
    vi.stubEnv('AUTH_SECRET', '')
    const { getInternalOrganizer } = await import('@/server/internal-api')
    expect(await getInternalOrganizer({ messengerId: '42' })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('POSTs the lookup with the derived secret header', async () => {
    const { getInternalOrganizer } = await import('@/server/internal-api')
    const record = await getInternalOrganizer({ messenger: 'telegram', messengerId: '42' })
    expect(record?.slug).toBe('yoga-anna')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('http://api.test/api/internal/auth/organizer-by-messenger')
    expect((init as RequestInit).method).toBe('POST')
    expect((init as RequestInit).cache).toBe('no-store')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      messenger: 'telegram',
      messengerId: '42',
    })
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers['x-internal-secret']).toBe(
      '73b1b535eb4ded0b2f67951c5f9baf63b26be71360d8401d8a49d2a24c1dd106',
    )
  })

  it('returns null for a lookup shape the contract rejects', async () => {
    const { getInternalOrganizer } = await import('@/server/internal-api')
    expect(await getInternalOrganizer({ organizerId: 'not-a-uuid' })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps 404 and 400 to null', async () => {
    const { getInternalOrganizer } = await import('@/server/internal-api')
    fetchMock.mockResolvedValueOnce(new Response('missing', { status: 404 }))
    expect(await getInternalOrganizer({ messengerId: '42' })).toBeNull()
    fetchMock.mockResolvedValueOnce(new Response('bad', { status: 400 }))
    expect(await getInternalOrganizer({ messengerId: '42' })).toBeNull()
  })

  it('throws on 401 — secret drift is a misconfiguration, not an unknown organizer', async () => {
    fetchMock.mockResolvedValue(new Response('denied', { status: 401 }))
    const { getInternalOrganizer } = await import('@/server/internal-api')
    await expect(getInternalOrganizer({ messengerId: '42' })).rejects.toThrow(
      'authentication failed',
    )
  })

  it('throws on other non-2xx answers', async () => {
    fetchMock.mockResolvedValue(new Response('oops', { status: 500 }))
    const { getInternalOrganizer } = await import('@/server/internal-api')
    await expect(getInternalOrganizer({ messengerId: '42' })).rejects.toThrow('answered 500')
  })

  it('throws on an envelope shape mismatch', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ nope: 1 }), { status: 200 }))
    const { getInternalOrganizer } = await import('@/server/internal-api')
    await expect(getInternalOrganizer({ messengerId: '42' })).rejects.toThrow('contract violation')
  })
})
