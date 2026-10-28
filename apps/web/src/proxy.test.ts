import { beforeEach, describe, expect, it, vi } from 'vitest'

// the middleware contract. Three behaviors are load-bearing:
// 1. A signed-in organizer never sees /login or /signup (redirect to the
//    cabinet) — if this file stops being picked up as middleware, this
//    silently breaks (see the header comment in proxy.ts).
// 2. /api/* requests carry the minted X-Organizer-Auth header for the
//    API — in the *request* headers, never the response.
// 3. In the container twin (API_URL set, VERCEL !== '1') /api/* is
//    rewritten to the API origin — browser calls would 404 on the
//    standalone server, which owns no such routes.

const mockAuth = vi.fn()
vi.mock('@/server/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}))

const mockMint = vi.fn()
vi.mock('@/server/auth/organizer-token', () => ({
  ORGANIZER_AUTH_HEADER: 'x-organizer-auth',
  mintOrganizerAuth: (...args: unknown[]) => mockMint(...args),
}))

// The real edge-safe verifier runs: its WebCrypto derivation is part of
// what these tests pin. 'test-auth-secret' → this derived hex value
// (same golden vector as internal-api.test.ts).
const VALID_INTERNAL_SECRET = '73b1b535eb4ded0b2f67951c5f9baf63b26be71360d8401d8a49d2a24c1dd106'

import { NextRequest, NextResponse } from 'next/server'

import { config, proxy } from './proxy'

function makeRequest(pathname: string, headers: Record<string, string> = {}): NextRequest {
  const url = new URL(`https://countmein.group${pathname}`)
  return new NextRequest(url, { headers: new Headers({ 'user-agent': 'test', ...headers }) })
}

beforeEach(() => {
  mockAuth.mockReset()
  mockMint.mockReset()
  vi.unstubAllEnvs()
})

describe('proxy — auth pages', () => {
  it('redirects a signed-in organizer away from /login', async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: 'org-1' } })
    const res = await proxy(makeRequest('/login'))
    expect(res).toBeInstanceOf(NextResponse)
    expect(res?.status).toBe(307)
    expect(new URL(res!.headers.get('location')!).pathname).toBe('/cabinet')
  })

  it('redirects a signed-in organizer away from /signup', async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: 'org-1' } })
    const res = await proxy(makeRequest('/signup'))
    expect(new URL(res!.headers.get('location')!).pathname).toBe('/cabinet')
  })

  it('lets an anonymous visitor through to /login', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await proxy(makeRequest('/login'))
    expect(res).toBeInstanceOf(NextResponse)
    expect(res!.status).toBe(200)
    expect(res!.headers.get('location')).toBeNull()
  })
})

describe('proxy — API header minting', () => {
  it('mints X-Organizer-Auth into the REQUEST headers for a signed-in organizer', async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: 'org-1', slug: 'yoga' } })
    mockMint.mockResolvedValueOnce('minted-jwt')

    const res = await proxy(makeRequest('/api/services'))
    expect(res).toBeInstanceOf(NextResponse)
    expect(mockMint).toHaveBeenCalledWith('org-1', 'yoga')
    // The minted token must reach the API handler: NextResponse.next with
    // request headers encodes the override as `x-middleware-request-*` on
    // the response, which is what Next forwards to the handler. Setting
    // the header on the response itself (the old bug) never did.
    expect(res!.headers.get('x-middleware-request-x-organizer-auth')).toBe('minted-jwt')
  })

  it('does not mint for anonymous API requests (the Python API sees no header)', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await proxy(makeRequest('/api/services'))
    expect(mockMint).not.toHaveBeenCalled()
    expect(res!.headers.get('x-middleware-request-x-organizer-auth')).toBeNull()
  })

  it('strips a client-supplied X-Organizer-Auth when there is no session', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await proxy(
      makeRequest('/api/services', { 'x-organizer-auth': 'forged-by-the-client' }),
    )
    expect(mockMint).not.toHaveBeenCalled()
    // The header is middleware-minted or absent — a forged value must
    // never reach the Python API.
    expect(res!.headers.get('x-middleware-request-x-organizer-auth')).toBeNull()
  })

  it('overwrites a client-supplied X-Organizer-Auth with the minted token', async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: 'org-1', slug: 'yoga' } })
    mockMint.mockResolvedValueOnce('minted-jwt')
    const res = await proxy(
      makeRequest('/api/services', { 'x-organizer-auth': 'forged-by-the-client' }),
    )
    expect(res!.headers.get('x-middleware-request-x-organizer-auth')).toBe('minted-jwt')
  })

  it('passes X-Organizer-Auth through for a verified internal-secret caller', async () => {
    // Server-to-server calls (SSR apiFetch) mint the header inside the
    // request — x-internal-secret proves they are ours, and the edge
    // cannot see a session cookie there: stripping it served every SSR
    // cabinet read anonymously (the demo-cabinet regression).
    vi.stubEnv('AUTH_SECRET', 'test-auth-secret')
    const res = await proxy(
      makeRequest('/api/organizers/me', {
        'x-internal-secret': VALID_INTERNAL_SECRET,
        'x-organizer-auth': 'server-minted-jwt',
      }),
    )
    expect(res!.headers.get('x-middleware-request-x-organizer-auth')).toBe('server-minted-jwt')
    expect(mockAuth).not.toHaveBeenCalled()
    expect(mockMint).not.toHaveBeenCalled()
  })

  it('still strips X-Organizer-Auth when x-internal-secret is present but invalid', async () => {
    vi.stubEnv('AUTH_SECRET', 'test-auth-secret')
    mockAuth.mockResolvedValueOnce(null)
    const res = await proxy(
      makeRequest('/api/services', {
        'x-internal-secret': 'not-the-derived-secret',
        'x-organizer-auth': 'forged-by-the-client',
      }),
    )
    expect(res!.headers.get('x-middleware-request-x-organizer-auth')).toBeNull()
  })

  it('skips the Auth.js routes — they stay on Next.js', async () => {
    await proxy(makeRequest('/api/auth/session/telegram'))
    expect(mockAuth).not.toHaveBeenCalled()
    expect(mockMint).not.toHaveBeenCalled()
  })

  it('treats /api/auth/telegram-* as Python routes despite the auth prefix', async () => {
    // The id_token→ticket endpoints live under /api/auth/ but belong to the
    // Python API — in the container twin they must be rewritten to API_URL
    // like every other API route, or Auth.js answers "unknown action".
    vi.stubEnv('API_URL', 'http://api:3001')
    mockAuth.mockResolvedValueOnce(null)

    const guest = await proxy(makeRequest('/api/auth/telegram-guest'))
    expect(guest!.headers.get('x-middleware-rewrite')).toBe(
      'http://api:3001/api/auth/telegram-guest',
    )

    mockAuth.mockResolvedValueOnce(null)
    const signup = await proxy(makeRequest('/api/auth/telegram-signup'))
    expect(signup!.headers.get('x-middleware-rewrite')).toBe(
      'http://api:3001/api/auth/telegram-signup',
    )
  })

  it('a failed mint degrades to anonymous (no header, no crash)', async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: 'org-1', slug: 'yoga' } })
    mockMint.mockResolvedValueOnce(null) // e.g. AUTH_SECRET missing
    const res = await proxy(makeRequest('/api/services'))
    expect(res).toBeInstanceOf(NextResponse)
    expect(res!.headers.get('x-middleware-request-x-organizer-auth')).toBeNull()
  })
})

describe('proxy — container rewrite (API_URL, VERCEL !== 1)', () => {
  it('rewrites /api/* to API_URL, carrying the minted header', async () => {
    vi.stubEnv('API_URL', 'http://api:3001/')
    mockAuth.mockResolvedValueOnce({ user: { id: 'org-1', slug: 'yoga' } })
    mockMint.mockResolvedValueOnce('minted-jwt')

    const res = await proxy(makeRequest('/api/services?limit=50'))
    expect(res).toBeInstanceOf(NextResponse)
    // A rewrite answers with the rewrite target in x-middleware-rewrite.
    expect(res!.headers.get('x-middleware-rewrite')).toBe('http://api:3001/api/services?limit=50')
    expect(res!.headers.get('x-middleware-request-x-organizer-auth')).toBe('minted-jwt')
  })

  it('passes through on Vercel even with API_URL set (Edge Router owns routing)', async () => {
    vi.stubEnv('API_URL', 'http://api:3001')
    vi.stubEnv('VERCEL', '1')
    mockAuth.mockResolvedValueOnce(null)

    const res = await proxy(makeRequest('/api/services'))
    expect(res).toBeInstanceOf(NextResponse)
    expect(res!.headers.get('x-middleware-rewrite')).toBeNull()
    // Pass-through: status 200 with no redirect/rewrite markers.
    expect(res!.status).toBe(200)
  })

  it('passes through without API_URL (Vercel same-origin)', async () => {
    mockAuth.mockResolvedValueOnce(null)

    const res = await proxy(makeRequest('/api/services'))
    expect(res!.headers.get('x-middleware-rewrite')).toBeNull()
    expect(res!.status).toBe(200)
  })
})

describe('proxy — /api/realtime (ADR-025)', () => {
  it('the matcher does NOT match /api/realtime — the SSE route must never be rewritten', () => {
    // Next.js matcher syntax: a literal prefix plus one regex group.
    const apiEntry = config.matcher.find((m) => m.startsWith('/api/'))
    const group = apiEntry!.match(/^\/api\/(\(.*\))$/)![1]!
    const re = new RegExp(`^/api/${group}$`)
    expect(re.test('/api/realtime')).toBe(false)
    expect(re.test('/api/realtime/extra')).toBe(false)
    // Lookalikes must not slip out: /api/realtimeXYZ stays covered.
    expect(re.test('/api/realtime-stats')).toBe(true)
    // Neighbours stay covered — the pin guards a widened exclusion.
    expect(re.test('/api/services')).toBe(true)
    expect(re.test('/api/auth/telegram-guest')).toBe(true)
    expect(re.test('/api/auth/session')).toBe(false)
    expect(re.test('/api/internal/revalidate')).toBe(false)
  })

  it('passes /api/realtime through untouched even if it is invoked (matcher guard)', async () => {
    // The in-function guard is the second line if the matcher re-matches.
    vi.stubEnv('API_URL', 'http://api:3001')
    const res = await proxy(makeRequest('/api/realtime?channel=service:svc-1'))
    expect(res!.headers.get('x-middleware-rewrite')).toBeNull()
    expect(mockAuth).not.toHaveBeenCalled()
    expect(mockMint).not.toHaveBeenCalled()
  })
})

describe('proxy — non-matched surfaces', () => {
  it('passes cabinet and public pages through untouched', async () => {
    // /cabinet is deliberately NOT in the matcher logic — anonymous
    // visitors get the demo cabinet, not a redirect (ADR-010).
    const res = await proxy(makeRequest('/cabinet/bookings'))
    expect(res).toBeInstanceOf(NextResponse)
    expect(res!.status).toBe(200)
    expect(mockAuth).not.toHaveBeenCalled()
  })
})
