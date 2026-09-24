import type { OrganizerProfile, ServiceRecord, TimeSlotRecord } from '@repo/contracts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useRegisterOrganizer, useSignInWithTicket } from './auth'
import { ApiError } from './error'
import { queryKeys } from './keys'
import { useCurrentOrganizer, useIsDemo, useUpdateOrganizerProfile } from './organizer'
import { useCreateService, useDeleteService, useUpdateService } from './service'
import { useCreateSlot, useDeleteSlot, useUpdateSlot } from './time-slot'

// the cabinet mutations — method/path/body from packages/contracts
// routes, merge-patch media type on partial updates (ADR-016), and the
// organizer profile cache write on success (queryKeys.organizer.me).

// ── mocks ─────────────────────────────────────────────────────────────────────

const mockSignIn = vi.fn()
vi.mock('next-auth/react', () => ({
  signIn: (...args: unknown[]) => mockSignIn(...args),
}))

function mockResponse(body: unknown, ok: boolean, status: number) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ── fixtures ──────────────────────────────────────────────────────────────────

const serviceFixture = {
  id: 'svc-abc123xyz',
  organizerId: '01930000-0000-7000-8000-0000000000a2',
  title: 'Morning Yoga',
  description: null,
  photoUrl: null,
  location: null,
  contact: null,
  defaultPrice: '€15',
  defaultCapacity: 10,
  defaultDurationMinutes: 60,
  maxSeatsPerBooking: 4,
  options: null,
  optionsSelectMode: null,
  createdAt: '2026-01-01T00:00:00.000Z',
} as unknown as ServiceRecord

const slotFixture = {
  id: '01930000-0000-7000-8000-0000000000a1',
  serviceId: 'svc-abc123xyz',
  startsAt: '2026-07-25T05:00:00.000Z',
  durationMinutes: 60,
  capacity: 10,
  bookedCount: 3,
  price: null,
  createdAt: '2026-01-01T00:00:00.000Z',
} as unknown as TimeSlotRecord

const organizerProfileFixture = {
  id: '01930000-0000-7000-8000-0000000000a2',
  slug: 'yoga-studio',
  name: 'Yoga Studio',
  messenger: 'telegram',
  messengerId: '12345',
  timezone: 'Europe/Belgrade',
  description: null,
  photoUrl: null,
  location: null,
  contact: null,
  language: 'en',
  createdAt: '2026-01-01T00:00:00.000Z',
  isDemo: false,
} as OrganizerProfile

// ── wrapper ───────────────────────────────────────────────────────────────────

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
  return { Wrapper, queryClient }
}

// ── service hooks ─────────────────────────────────────────────────────────────

describe('useCreateService', () => {
  it('POSTs /api/services with the input body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ service: serviceFixture }, true, 201))

    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useCreateService(), { wrapper: Wrapper })
    const input = {
      title: 'Morning Yoga',
      defaultPrice: '€15',
      defaultCapacity: 10,
      defaultDurationMinutes: 60,
      maxSeatsPerBooking: 4,
    }
    await act(async () => {
      await result.current.mutateAsync(input)
    })

    expect(fetch).toHaveBeenCalledWith(
      '/api/services',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    )
  })
})

describe('useUpdateService', () => {
  it('PUTs a merge-patch body to /api/services/{id} (ADR-016)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ service: serviceFixture }, true, 200))

    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useUpdateService('svc-abc123xyz'), { wrapper: Wrapper })
    // The options pair must always travel together (AGENTS.md).
    const input = { options: ['Mat', 'Towel'], optionsSelectMode: 'multi' as const }
    await act(async () => {
      await result.current.mutateAsync(input)
    })

    expect(fetch).toHaveBeenCalledWith(
      '/api/services/svc-abc123xyz',
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'application/merge-patch+json' },
        body: JSON.stringify(input),
      }),
    )
  })
})

describe('useDeleteService', () => {
  it('DELETEs /api/services/{id}', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ id: 'svc-abc123xyz' }, true, 200))

    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useDeleteService('svc-abc123xyz'), { wrapper: Wrapper })
    await act(async () => {
      await result.current.mutateAsync()
    })

    expect(fetch).toHaveBeenCalledWith('/api/services/svc-abc123xyz', { method: 'DELETE' })
  })
})

// ── slot hooks ────────────────────────────────────────────────────────────────

describe('useCreateSlot', () => {
  it('POSTs /api/slots with the input body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ slot: slotFixture }, true, 201))

    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useCreateSlot(), { wrapper: Wrapper })
    const input = {
      serviceId: 'svc-abc123xyz',
      startsAt: new Date('2026-07-25T05:00:00.000Z'),
      durationMinutes: 60,
      capacity: 10,
    }
    await act(async () => {
      await result.current.mutateAsync(input)
    })

    expect(fetch).toHaveBeenCalledWith(
      '/api/slots',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    )
  })
})

describe('useUpdateSlot', () => {
  it('PUTs a merge-patch body to /api/slots/{id}', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ slot: slotFixture }, true, 200))

    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useUpdateSlot('01930000-0000-7000-8000-0000000000a1'), {
      wrapper: Wrapper,
    })
    const input = { capacity: 12 }
    await act(async () => {
      await result.current.mutateAsync(input)
    })

    expect(fetch).toHaveBeenCalledWith(
      '/api/slots/01930000-0000-7000-8000-0000000000a1',
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'application/merge-patch+json' },
        body: JSON.stringify(input),
      }),
    )
  })
})

describe('useDeleteSlot', () => {
  it('DELETEs /api/slots/{id} and surfaces the 409 while bookings exist', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse({ error: 'has bookings', code: 'slotHasBookings' }, false, 409),
    )

    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useDeleteSlot('01930000-0000-7000-8000-0000000000a1'), {
      wrapper: Wrapper,
    })
    let caught: unknown
    await act(async () => {
      try {
        await result.current.mutateAsync()
      } catch (e) {
        caught = e
      }
    })

    expect(fetch).toHaveBeenCalledWith('/api/slots/01930000-0000-7000-8000-0000000000a1', {
      method: 'DELETE',
    })
    expect(caught).toBeInstanceOf(ApiError)
    expect(caught).toMatchObject({ status: 409, code: 'slotHasBookings' })
  })
})

// ── organizer hooks ──────────────────────────────────────────────────────────

describe('useCurrentOrganizer', () => {
  it('GETs /api/organizers/me under the organizer.me key and selects the profile', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse({ organizer: organizerProfileFixture }, true, 200),
    )

    const { Wrapper, queryClient } = createWrapper()
    const { result } = renderHook(() => useCurrentOrganizer(), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(fetch).toHaveBeenCalledWith('/api/organizers/me')
    expect(result.current.data).toEqual(organizerProfileFixture)
    // The cache entry lives under the shared key factory — the mutation
    // that invalidates it must agree (keys.ts is the single source).
    expect(queryClient.getQueryData(queryKeys.organizer.me)).toEqual({
      organizer: organizerProfileFixture,
    })
  })
})

describe('useIsDemo', () => {
  it('is false while loading and follows the profile isDemo flag', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse({ organizer: { ...organizerProfileFixture, isDemo: true } }, true, 200),
    )

    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useIsDemo(), { wrapper: Wrapper })
    // Loading default: false — the API is the real gate (ADR-010).
    expect(result.current).toBe(false)
    await waitFor(() => expect(result.current).toBe(true))
  })
})

describe('useUpdateOrganizerProfile', () => {
  it('PUTs a merge-patch body and writes the response into the cache', async () => {
    const updated = { ...organizerProfileFixture, name: 'Renamed Studio' }
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ organizer: updated }, true, 200))

    const { Wrapper, queryClient } = createWrapper()
    const { result } = renderHook(() => useUpdateOrganizerProfile(), { wrapper: Wrapper })
    await act(async () => {
      await result.current.mutateAsync({ name: 'Renamed Studio' })
    })

    expect(fetch).toHaveBeenCalledWith(
      '/api/organizers/me',
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'application/merge-patch+json' },
        body: JSON.stringify({ name: 'Renamed Studio' }),
      }),
    )
    // The endpoint returns the updated profile — a refetch would be
    // redundant, so the mutation writes it straight into the cache.
    expect(queryClient.getQueryData(queryKeys.organizer.me)).toEqual({ organizer: updated })
  })
})

// ── auth hooks ────────────────────────────────────────────────────────────────

describe('useRegisterOrganizer', () => {
  it('POSTs /api/organizers with the input body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse(
        { organizer: { id: '01930000-0000-7000-8000-0000000000a9', slug: 'yoga-studio' } },
        true,
        201,
      ),
    )

    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useRegisterOrganizer(), { wrapper: Wrapper })
    const input = {
      ticket: 'signup-ticket',
      slug: 'yoga-studio',
      name: 'Yoga Studio',
      timezone: 'Europe/Belgrade',
      language: 'en' as const,
    }
    await act(async () => {
      await result.current.mutateAsync(input)
    })

    expect(fetch).toHaveBeenCalledWith(
      '/api/organizers',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(input),
      }),
    )
  })
})

describe('useSignInWithTicket', () => {
  it('signs in via Auth.js with the ticket and no redirect', async () => {
    mockSignIn.mockResolvedValueOnce({ error: null })

    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useSignInWithTicket(), { wrapper: Wrapper })
    await act(async () => {
      await result.current.mutateAsync('ticket-123')
    })

    expect(mockSignIn).toHaveBeenCalledWith('telegram', { ticket: 'ticket-123', redirect: false })
  })

  it('throws ApiError(401) when Auth.js reports an error (ticket consumed/expired)', async () => {
    mockSignIn.mockResolvedValueOnce({ error: 'CredentialsSignin' })

    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useSignInWithTicket(), { wrapper: Wrapper })
    let caught: unknown
    await act(async () => {
      try {
        await result.current.mutateAsync('ticket-123')
      } catch (e) {
        caught = e
      }
    })

    expect(caught).toBeInstanceOf(ApiError)
    expect(caught).toMatchObject({ status: 401 })
  })
})
