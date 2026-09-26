import type { BookingRecord, GuestBooking } from '@repo/contracts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  useCancelBooking,
  useCancelBookingByOrganizer,
  useCreateBooking,
  useLookupBookings,
} from './booking'
import { ApiError } from './error'

// the guest/cabinet booking mutations are the browser end of the
// wire — each one spends a single-use credential (guest ticket,
// manageToken, or the session), so the exact method/path/body is the
// contract, and `retry: false` is load-bearing (a retry always hits a
// 401/409 that overwrites the real result).

// ── fetch mock ────────────────────────────────────────────────────────────────

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

const slotFixture = {
  id: '01930000-0000-7000-8000-0000000000a1',
  serviceId: 'svc-abc123xyz',
  startsAt: '2026-07-25T05:00:00.000Z',
  durationMinutes: 60,
  capacity: 10,
  bookedCount: 3,
  price: null,
  createdAt: '2026-01-01T00:00:00.000Z',
}

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
}

const organizerFixture = {
  id: '01930000-0000-7000-8000-0000000000a2',
  slug: 'yoga-studio',
  name: 'Yoga Studio',
  timezone: 'Europe/Belgrade',
  description: null,
  photoUrl: null,
  location: null,
  contact: null,
  isDemo: false,
}

const guestBookingFixture = {
  id: '01930000-0000-7000-8000-0000000000a3',
  status: 'confirmed',
  seats: 2,
  guestName: 'Jane Doe',
  selectedOptions: null,
  createdAt: '2026-07-20T10:00:00.000Z',
  manageToken: 'manage-token-123',
  canCancel: true,
  slot: slotFixture,
  service: serviceFixture,
  organizer: organizerFixture,
} as unknown as GuestBooking

const bookingRecordFixture = {
  id: '01930000-0000-7000-8000-0000000000a3',
  timeSlotId: slotFixture.id,
  status: 'confirmed',
  seats: 2,
  guestName: 'Jane Doe',
  guestMessenger: 'telegram',
  guestMessengerId: '67890',
  guestMessengerLogin: 'janedoe',
  selectedOptions: null,
  createdAt: '2026-07-20T10:00:00.000Z',
} as BookingRecord

// ── wrapper ───────────────────────────────────────────────────────────────────

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
  return Wrapper
}

// ── useCreateBooking ──────────────────────────────────────────────────────────

describe('useCreateBooking', () => {
  it('POSTs /api/bookings with the input body and resolves the envelope', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse({ booking: guestBookingFixture }, true, 201),
    )

    const { result } = renderHook(() => useCreateBooking(), { wrapper: createWrapper() })

    const input = {
      serviceId: 'svc-1',
      timeSlotId: slotFixture.id,
      seats: 2,
      guestName: 'Jane Doe',
      guestTicket: 'guest-ticket-123',
      guestLocale: 'en' as const,
    }
    let created: unknown
    await act(async () => {
      created = await result.current.mutateAsync(input)
    })

    expect(fetch).toHaveBeenCalledWith(
      '/api/bookings',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    )
    expect(created).toEqual({ booking: guestBookingFixture })
  })

  it('does not retry: the ticket is single-use, a retry would 401', async () => {
    // Behavioral pin: a failing create is fetched exactly once — the
    // ticket is spent, so a retry always 401s and would overwrite the
    // real result.
    vi.mocked(fetch).mockResolvedValue(
      mockResponse({ error: 'expired', code: 'ticketExpired' }, false, 401),
    )
    const { result } = renderHook(() => useCreateBooking(), { wrapper: createWrapper() })
    await act(async () => {
      await result.current
        .mutateAsync({
          serviceId: 'svc-abc123xyz',
          timeSlotId: slotFixture.id,
          seats: 1,
          guestName: 'Jane',
          guestTicket: 't',
          guestLocale: 'en',
        })
        .catch(() => {})
    })
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })

  it('surfaces a sold-out 409 as ApiError with seatsLeft extras', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse(
        { error: 'Only 1 seat left on this session', code: 'slot_sold_out', seatsLeft: 1 },
        false,
        409,
      ),
    )

    const { result } = renderHook(() => useCreateBooking(), { wrapper: createWrapper() })
    let caught: unknown
    await act(async () => {
      try {
        await result.current.mutateAsync({
          serviceId: 'svc-1',
          timeSlotId: slotFixture.id,
          seats: 2,
          guestName: 'Jane',
          guestTicket: 't',
          guestLocale: 'en',
        })
      } catch (e) {
        caught = e
      }
    })

    expect(caught).toBeInstanceOf(ApiError)
    expect(caught).toMatchObject({ status: 409, code: 'slot_sold_out' })
  })
})

// ── useCancelBooking ─────────────────────────────────────────────────────────

describe('useCancelBooking', () => {
  it('sends the manageToken in the body, never the URL', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse({ booking: guestBookingFixture }, true, 200),
    )

    const { result } = renderHook(() => useCancelBooking(), { wrapper: createWrapper() })
    await act(async () => {
      await result.current.mutateAsync('secret-manage-token')
    })

    expect(fetch).toHaveBeenCalledTimes(1)
    const calls = vi.mocked(fetch).mock.calls as unknown as Array<[string, RequestInit]>
    const [url, init] = calls[0] as [string, RequestInit]
    // The token is a secret: query strings end up in logs and Referer.
    expect(String(url)).not.toContain('secret-manage-token')
    expect(String(url)).toBe('/api/bookings/cancel')
    expect(JSON.parse(String(init?.body))).toEqual({ manageToken: 'secret-manage-token' })
  })

  it('does not retry (already-cancelled would overwrite the real result)', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockResponse({ error: 'already cancelled', code: 'alreadyCancelled' }, false, 409),
    )
    const { result } = renderHook(() => useCancelBooking(), { wrapper: createWrapper() })
    await act(async () => {
      await result.current.mutateAsync('tok').catch(() => {})
    })
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })

  it('maps an unknown-token 404 to ApiError', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse({ error: 'Booking not found', code: 'bookingNotFound' }, false, 404),
    )

    const { result } = renderHook(() => useCancelBooking(), { wrapper: createWrapper() })
    let caught: unknown
    await act(async () => {
      try {
        await result.current.mutateAsync('unknown-token')
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toMatchObject({ status: 404, code: 'bookingNotFound' })
  })
})

// ── useCancelBookingByOrganizer ───────────────────────────────────────────────

describe('useCancelBookingByOrganizer', () => {
  it('POSTs the bookingId to the cabinet cancel endpoint', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse({ booking: bookingRecordFixture }, true, 200),
    )

    const { result } = renderHook(() => useCancelBookingByOrganizer(), { wrapper: createWrapper() })
    await act(async () => {
      await result.current.mutateAsync(bookingRecordFixture.id)
    })

    expect(fetch).toHaveBeenCalledWith(
      '/api/bookings/cancel-by-organizer',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ bookingId: bookingRecordFixture.id }),
      }),
    )
  })

  it('maps the demo 403 to ApiError with the demo code', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse({ error: 'read-only demo', code: 'DEMO_READ_ONLY' }, false, 403),
    )

    const { result } = renderHook(() => useCancelBookingByOrganizer(), { wrapper: createWrapper() })
    let caught: unknown
    await act(async () => {
      try {
        await result.current.mutateAsync(bookingRecordFixture.id)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toMatchObject({ status: 403, code: 'DEMO_READ_ONLY' })
  })
})

// ── useLookupBookings ─────────────────────────────────────────────────────────

describe('useLookupBookings', () => {
  it('POSTs only the ticket — a raw messengerId is never sent', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse({ bookings: [guestBookingFixture] }, true, 200),
    )

    const { result } = renderHook(() => useLookupBookings(), { wrapper: createWrapper() })
    let bookings: unknown
    await act(async () => {
      bookings = await result.current.mutateAsync({
        ticket: 'guest-ticket-123',
        messenger: 'telegram',
        messengerId: '67890',
      })
    })

    const calls = vi.mocked(fetch).mock.calls as unknown as Array<[string, RequestInit]>
    const [url, init] = calls[0] as [string, RequestInit]
    expect(String(url)).toBe('/api/bookings/lookup')
    const body = JSON.parse(String(init?.body))
    expect(body).toEqual({ guestTicket: 'guest-ticket-123' })
    expect(body.messengerId).toBeUndefined()
    expect(bookings).toEqual([guestBookingFixture])
  })

  it('maps an expired-ticket 401 to ApiError', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse({ error: 'expired', code: 'ticketExpired' }, false, 401),
    )

    const { result } = renderHook(() => useLookupBookings(), { wrapper: createWrapper() })
    let caught: unknown
    await act(async () => {
      try {
        await result.current.mutateAsync({
          ticket: 't',
          messenger: 'telegram',
          messengerId: '67890',
        })
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toMatchObject({ status: 401, code: 'ticketExpired' })
  })
})

// ── status → ApiError classification across the mutation set ─────────────────

describe('ApiError classification', () => {
  const cases = [
    { status: 401, code: 'ticketExpired' },
    { status: 403, code: 'DEMO_READ_ONLY' },
    { status: 404, code: 'bookingNotFound' },
    { status: 409, code: 'duplicate_booking' },
    { status: 429, code: undefined },
  ]
  it.each(cases)(
    'classifies $status responses into ApiError with code',
    async ({ status, code }) => {
      vi.mocked(fetch).mockResolvedValueOnce(
        mockResponse({ error: 'err', ...(code ? { code } : {}) }, false, status),
      )
      const { result } = renderHook(() => useCancelBooking(), { wrapper: createWrapper() })
      let caught: unknown
      await act(async () => {
        try {
          await result.current.mutateAsync('tok')
        } catch (e) {
          caught = e
        }
      })
      await waitFor(() => expect(caught).toBeInstanceOf(ApiError))
      expect(caught).toMatchObject({ status, ...(code ? { code } : {}) })
    },
  )
})
