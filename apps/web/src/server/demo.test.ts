import { DEMO_ORGANIZER_ID } from '@repo/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// the read-side demo resolution (ADR-010). Anonymous visitors get
// the demo organizer; a signed-in organizer gets their own id; a session
// carrying the demo id is still demo. The write-side guards live in the
// Go API — this is the page-rendering half.

const mockAuth = vi.fn()
vi.mock('./auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}))

import { isDemoSession, resolveCabinetOrganizerId } from './demo'

beforeEach(() => {
  mockAuth.mockReset()
})

describe('resolveCabinetOrganizerId', () => {
  it('an anonymous visitor gets the demo organizer (no session)', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const resolved = await resolveCabinetOrganizerId()
    expect(resolved).toEqual({ organizerId: DEMO_ORGANIZER_ID, isDemo: true })
  })

  it('a session without a user id is anonymous too', async () => {
    mockAuth.mockResolvedValueOnce({ user: null })
    const resolved = await resolveCabinetOrganizerId()
    expect(resolved).toEqual({ organizerId: DEMO_ORGANIZER_ID, isDemo: true })
  })

  it('a signed-in organizer gets their own id', async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: '01930000-0000-7000-8000-0000000000a1' } })
    const resolved = await resolveCabinetOrganizerId()
    expect(resolved).toEqual({
      organizerId: '01930000-0000-7000-8000-0000000000a1',
      isDemo: false,
    })
  })

  it('a session carrying the demo id stays demo', async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: DEMO_ORGANIZER_ID } })
    const resolved = await resolveCabinetOrganizerId()
    expect(resolved).toEqual({ organizerId: DEMO_ORGANIZER_ID, isDemo: true })
  })
})

describe('isDemoSession', () => {
  it('follows resolveCabinetOrganizerId', async () => {
    mockAuth.mockResolvedValueOnce(null)
    expect(await isDemoSession()).toBe(true)
    mockAuth.mockResolvedValueOnce({ user: { id: '01930000-0000-7000-8000-0000000000a2' } })
    expect(await isDemoSession()).toBe(false)
  })
})
