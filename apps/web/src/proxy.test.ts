import { beforeEach, describe, expect, it, vi } from 'vitest'

// the middleware contract. Two behaviors are load-bearing:
// 1. A signed-in organizer never sees /login or /signup (redirect to the
//    cabinet) — if this file stops being picked up as middleware, this
//    silently breaks (see the header comment in proxy.ts).
// 2. /api/* requests carry the minted X-Organizer-Auth header for the Go
//    API — in the *request* headers, never the response.

const mockAuth = vi.fn()
vi.mock('@/server/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}))

const mockMint = vi.fn()
vi.mock('@/server/auth/organizer-token', () => ({
  ORGANIZER_AUTH_HEADER: 'x-organizer-auth',
  mintOrganizerAuth: (...args: unknown[]) => mockMint(...args),
}))

import { NextRequest, NextResponse } from 'next/server'

import { proxy } from './proxy'

function makeRequest(pathname: string): NextRequest {
  const url = new URL(`https://countmein.group${pathname}`)
  return new NextRequest(url, { headers: new Headers({ 'user-agent': 'test' }) })
}

beforeEach(() => {
  mockAuth.mockReset()
  mockMint.mockReset()
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
    // The minted token must reach the Go handler: NextResponse.next with
    // request headers encodes the override as `x-middleware-request-*` on
    // the response, which is what Next forwards to the handler. Setting
    // the header on the response itself (the old bug) never did.
    expect(res!.headers.get('x-middleware-request-x-organizer-auth')).toBe('minted-jwt')
  })

  it('does not mint for anonymous API requests (the Go API sees no header)', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await proxy(makeRequest('/api/services'))
    expect(mockMint).not.toHaveBeenCalled()
    expect(res!.headers.get('x-middleware-request-x-organizer-auth')).toBeNull()
  })

  it('skips the Auth.js routes — they stay on Next.js', async () => {
    await proxy(makeRequest('/api/auth/session/telegram'))
    expect(mockAuth).not.toHaveBeenCalled()
    expect(mockMint).not.toHaveBeenCalled()
  })

  it('a failed mint degrades to anonymous (no header, no crash)', async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: 'org-1', slug: 'yoga' } })
    mockMint.mockResolvedValueOnce(null) // e.g. AUTH_SECRET missing
    const res = await proxy(makeRequest('/api/services'))
    expect(res).toBeInstanceOf(NextResponse)
    expect(res!.headers.get('x-middleware-request-x-organizer-auth')).toBeNull()
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
