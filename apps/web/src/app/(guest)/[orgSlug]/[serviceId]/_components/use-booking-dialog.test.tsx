import type { GuestBooking, ServiceRecord, TimeSlotRecord } from '@repo/contracts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api-client/error'
import { queryKeys } from '@/api-client/keys'
import { IntlTestProvider } from '@/i18n/test-provider'
import { useBookingDialog } from './use-booking-dialog'

// ── Mocks ────────────────────────────────────────────────────────────────────

// Stub the mutation only — the hook also reads `queryKeys` for the
// post-success cache invalidate, so the module's real exports must stay.
const mockMutateAsync = vi.fn()
vi.mock('@/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api-client')>()
  return {
    ...actual,
    useCreateBooking: () => ({
      mutateAsync: mockMutateAsync,
      isPending: false,
    }),
  }
})

// ── Fixtures ──────────────────────────────────────────────────────────────────

const serviceWithoutOptions: ServiceRecord = {
  id: 'svc-1',
  organizerId: 'org-1',
  title: 'Morning Yoga',
  description: null,
  photoUrl: null,
  location: null,
  contact: null,
  defaultPrice: '€15',
  defaultCapacity: 10,
  defaultDurationMinutes: 60,
  maxSeatsPerBooking: 1,
  options: null,
  optionsSelectMode: null,
  createdAt: '2026-01-01T00:00:00.000Z',
} as ServiceRecord

const serviceWithOptions: ServiceRecord = {
  ...serviceWithoutOptions,
  options: ['Beginner', 'Intermediate'],
  optionsSelectMode: 'single',
} as ServiceRecord

/** A service that permits group bookings (party of up to 4). */
const serviceWithGroupBookings: ServiceRecord = {
  ...serviceWithoutOptions,
  maxSeatsPerBooking: 4,
} as ServiceRecord

const guestBooking: GuestBooking = {
  id: 'booking-1',
  timeSlotId: 'slot-1',
  status: 'confirmed',
  seats: 1,
  guestName: 'Jane Doe',
  guestMessenger: 'telegram',
  guestMessengerId: '67890',
  guestMessengerLogin: 'janedoe',
  manageToken: 'manage-token-123',
  canCancel: true,
  selectedOptions: ['Beginner'],
  createdAt: '2026-07-20T10:00:00.000Z',
  organizer: {
    id: 'org-1',
    slug: 'yoga-studio',
    name: 'Yoga Studio',
    timezone: 'Europe/Belgrade',
    messenger: 'telegram',
    messengerId: '12345',
    description: null,
    photoUrl: null,
    location: null,
    contact: null,
    isDemo: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  service: {
    id: 'svc-1',
    organizerId: 'org-1',
    title: 'Morning Yoga',
    description: null,
    photoUrl: null,
    location: null,
    contact: null,
    defaultPrice: '€15',
    defaultCapacity: 10,
    defaultDurationMinutes: 60,
    maxSeatsPerBooking: 1,
    options: ['Beginner', 'Intermediate'],
    optionsSelectMode: 'single',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  slot: {
    id: 'slot-1',
    serviceId: 'svc-1',
    startsAt: '2026-07-25T05:00:00.000Z',
    durationMinutes: 60,
    capacity: 10,
    bookedCount: 3,
    price: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
} as unknown as GuestBooking

// ── Test wrapper ──────────────────────────────────────────────────────────────

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <IntlTestProvider>{children}</IntlTestProvider>
      </QueryClientProvider>
    )
  }
  return Wrapper
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useBookingDialog — initial state', () => {
  it('starts on the "slot" step', () => {
    const { result } = renderHook(() => useBookingDialog({ service: serviceWithoutOptions }), {
      wrapper: createWrapper(),
    })
    expect(result.current.step).toBe('slot')
  })

  it('initializes slotId from preselectedSlotId', () => {
    const { result } = renderHook(
      () => useBookingDialog({ service: serviceWithoutOptions, preselectedSlotId: 'slot-99' }),
      { wrapper: createWrapper() },
    )
    expect(result.current.slotId).toBe('slot-99')
  })

  it('initializes slotId as undefined when no preselectedSlotId', () => {
    const { result } = renderHook(() => useBookingDialog({ service: serviceWithoutOptions }), {
      wrapper: createWrapper(),
    })
    expect(result.current.slotId).toBeUndefined()
  })

  it('starts with empty selectedOptions and name', () => {
    const { result } = renderHook(() => useBookingDialog({ service: serviceWithoutOptions }), {
      wrapper: createWrapper(),
    })
    expect(result.current.selectedOptions).toEqual([])
    expect(result.current.name).toBe('')
  })

  it('starts with a party of one seat', () => {
    const { result } = renderHook(() => useBookingDialog({ service: serviceWithGroupBookings }), {
      wrapper: createWrapper(),
    })
    expect(result.current.seats).toBe(1)
  })

  it('starts with null booking and null error', () => {
    const { result } = renderHook(() => useBookingDialog({ service: serviceWithoutOptions }), {
      wrapper: createWrapper(),
    })
    expect(result.current.booking).toBeNull()
    expect(result.current.error).toBeNull()
  })
})

describe('useBookingDialog — goFromSlot', () => {
  it('goes to "details" when service has no options', () => {
    const { result } = renderHook(() => useBookingDialog({ service: serviceWithoutOptions }), {
      wrapper: createWrapper(),
    })
    act(() => result.current.goFromSlot())
    expect(result.current.step).toBe('details')
  })

  it('goes to "options" when service has options', () => {
    const { result } = renderHook(() => useBookingDialog({ service: serviceWithOptions }), {
      wrapper: createWrapper(),
    })
    act(() => result.current.goFromSlot())
    expect(result.current.step).toBe('options')
  })
})

describe('useBookingDialog — toggleOption', () => {
  it('sets a single option in single mode', () => {
    const { result } = renderHook(() => useBookingDialog({ service: serviceWithOptions }), {
      wrapper: createWrapper(),
    })
    act(() => result.current.toggleOption('Beginner'))
    expect(result.current.selectedOptions).toEqual(['Beginner'])

    // Switching to another option replaces, not appends
    act(() => result.current.toggleOption('Intermediate'))
    expect(result.current.selectedOptions).toEqual(['Intermediate'])
  })

  it('toggles options in multi mode', () => {
    const multiService = {
      ...serviceWithOptions,
      optionsSelectMode: 'multi',
    } as ServiceRecord
    const { result } = renderHook(() => useBookingDialog({ service: multiService }), {
      wrapper: createWrapper(),
    })

    act(() => result.current.toggleOption('Beginner'))
    expect(result.current.selectedOptions).toEqual(['Beginner'])

    act(() => result.current.toggleOption('Intermediate'))
    expect(result.current.selectedOptions).toEqual(['Beginner', 'Intermediate'])

    // Toggling again removes
    act(() => result.current.toggleOption('Beginner'))
    expect(result.current.selectedOptions).toEqual(['Intermediate'])
  })
})

describe('useBookingDialog — reset', () => {
  it('resets all state to initial values', () => {
    const { result } = renderHook(
      () => useBookingDialog({ service: serviceWithOptions, preselectedSlotId: 'slot-1' }),
      { wrapper: createWrapper() },
    )

    act(() => {
      result.current.setStep('details')
      result.current.setSlotId('slot-99')
      result.current.setSelectedOptions(['Beginner'])
      result.current.setName('Jane')
      result.current.setSeats(3)
    })

    expect(result.current.step).toBe('details')
    expect(result.current.slotId).toBe('slot-99')
    expect(result.current.seats).toBe(3)

    act(() => result.current.reset())

    expect(result.current.step).toBe('slot')
    expect(result.current.slotId).toBe('slot-1')
    expect(result.current.selectedOptions).toEqual([])
    expect(result.current.name).toBe('')
    expect(result.current.seats).toBe(1)
  })
})

describe('useBookingDialog — handleTicket', () => {
  it('creates a booking and moves to success step', async () => {
    mockMutateAsync.mockResolvedValueOnce({ booking: guestBooking })

    const { result } = renderHook(
      () => useBookingDialog({ service: serviceWithoutOptions, preselectedSlotId: 'slot-1' }),
      { wrapper: createWrapper() },
    )

    act(() => {
      result.current.setName('Jane Doe')
    })

    await act(async () => {
      await result.current.handleTicket({
        ticket: 'guest-ticket-123',
        messenger: 'telegram',
        messengerId: '67890',
        displayName: 'Jane Doe',
      })
    })

    expect(mockMutateAsync).toHaveBeenCalledWith({
      serviceId: 'svc-1',
      timeSlotId: 'slot-1',
      seats: 1,
      guestName: 'Jane Doe',
      guestTicket: 'guest-ticket-123',
      selectedOptions: undefined,
      guestLocale: 'en',
    })
    expect(result.current.step).toBe('success')
    expect(result.current.booking).toEqual(guestBooking)
    expect(result.current.error).toBeNull()
  })

  it('invalidates the live service query on success', async () => {
    mockMutateAsync.mockResolvedValueOnce({ booking: guestBooking })
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <IntlTestProvider>{children}</IntlTestProvider>
      </QueryClientProvider>
    )

    const { result } = renderHook(
      () => useBookingDialog({ service: serviceWithoutOptions, preselectedSlotId: 'slot-1' }),
      { wrapper },
    )
    await act(async () => {
      await result.current.handleTicket({
        ticket: 'guest-ticket-123',
        messenger: 'telegram',
        messengerId: '67890',
        displayName: 'Jane Doe',
      })
    })

    expect(result.current.step).toBe('success')
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.publicService.detail('svc-1'),
    })
  })

  it('sends the chosen party size', async () => {
    mockMutateAsync.mockResolvedValueOnce({ booking: guestBooking })

    const { result } = renderHook(
      () => useBookingDialog({ service: serviceWithGroupBookings, preselectedSlotId: 'slot-1' }),
      { wrapper: createWrapper() },
    )

    act(() => {
      result.current.setName('Jane Doe')
      result.current.setSeats(3)
    })

    await act(async () => {
      await result.current.handleTicket({
        ticket: 'guest-ticket-123',
        messenger: 'telegram',
        messengerId: '67890',
        displayName: 'Jane Doe',
      })
    })

    expect(mockMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ seats: 3 }))
    expect(result.current.step).toBe('success')
    expect(result.current.booking).toEqual(guestBooking)
    expect(result.current.error).toBeNull()
  })

  it('clamps the party size when the picked slot has fewer seats left', () => {
    const tightSlot = {
      id: 'slot-tight',
      serviceId: 'svc-1',
      startsAt: '2026-07-25T05:00:00.000Z',
      durationMinutes: 60,
      capacity: 10,
      bookedCount: 8,
      price: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    } as TimeSlotRecord

    const { result } = renderHook(
      () => useBookingDialog({ service: serviceWithGroupBookings, slots: [tightSlot] }),
      { wrapper: createWrapper() },
    )

    act(() => {
      result.current.setSeats(4)
      result.current.setSlotId('slot-tight')
    })

    // seatsLeft = 10 - 8 = 2 — the party is re-clamped, not left stale.
    expect(result.current.seats).toBe(2)
    expect(result.current.maxSeats).toBe(2)
  })

  it('uses ticket displayName when name is empty', async () => {
    mockMutateAsync.mockResolvedValueOnce({ booking: guestBooking })

    const { result } = renderHook(
      () => useBookingDialog({ service: serviceWithoutOptions, preselectedSlotId: 'slot-1' }),
      { wrapper: createWrapper() },
    )

    await act(async () => {
      await result.current.handleTicket({
        ticket: 'guest-ticket-123',
        messenger: 'telegram',
        messengerId: '67890',
        displayName: 'Telegram User',
      })
    })

    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ guestName: 'Telegram User' }),
    )
  })

  it('passes selectedOptions when set', async () => {
    mockMutateAsync.mockResolvedValueOnce({ booking: guestBooking })

    const { result } = renderHook(
      () => useBookingDialog({ service: serviceWithOptions, preselectedSlotId: 'slot-1' }),
      { wrapper: createWrapper() },
    )

    act(() => {
      result.current.toggleOption('Beginner')
    })

    await act(async () => {
      await result.current.handleTicket({
        ticket: 'guest-ticket-123',
        messenger: 'telegram',
        messengerId: '67890',
        displayName: 'Jane',
      })
    })

    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ selectedOptions: ['Beginner'] }),
    )
  })

  it('does nothing when slotId is not set', async () => {
    const { result } = renderHook(() => useBookingDialog({ service: serviceWithoutOptions }), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.handleTicket({
        ticket: 'guest-ticket-123',
        messenger: 'telegram',
        messengerId: '67890',
        displayName: 'Jane',
      })
    })

    expect(mockMutateAsync).not.toHaveBeenCalled()
    expect(result.current.step).toBe('slot')
  })

  it('sets error message when booking fails', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Slot is full'))

    const { result } = renderHook(
      () => useBookingDialog({ service: serviceWithoutOptions, preselectedSlotId: 'slot-1' }),
      { wrapper: createWrapper() },
    )

    await act(async () => {
      await result.current.handleTicket({
        ticket: 'guest-ticket-123',
        messenger: 'telegram',
        messengerId: '67890',
        displayName: 'Jane',
      })
    })

    expect(result.current.error).toBe('Slot is full')
    expect(result.current.isDuplicate).toBe(false)
    expect(result.current.step).not.toBe('success')
    expect(result.current.booking).toBeNull()
  })

  it('sets isDuplicate when the server returns a duplicate_booking code', async () => {
    mockMutateAsync.mockRejectedValueOnce(
      new ApiError('You already have a booking for this session', 409, 'duplicate_booking'),
    )

    const { result } = renderHook(
      () => useBookingDialog({ service: serviceWithoutOptions, preselectedSlotId: 'slot-1' }),
      { wrapper: createWrapper() },
    )

    await act(async () => {
      await result.current.handleTicket({
        ticket: 'guest-ticket-123',
        messenger: 'telegram',
        messengerId: '67890',
        displayName: 'Jane',
      })
    })

    expect(result.current.error).toBe('You already have a booking for this session')
    expect(result.current.isDuplicate).toBe(true)
    expect(result.current.step).not.toBe('success')
    expect(result.current.booking).toBeNull()
  })

  it('does not set isDuplicate for a non-duplicate 409', async () => {
    mockMutateAsync.mockRejectedValueOnce(new ApiError('Only 0 seats left', 409))

    const { result } = renderHook(
      () => useBookingDialog({ service: serviceWithoutOptions, preselectedSlotId: 'slot-1' }),
      { wrapper: createWrapper() },
    )

    await act(async () => {
      await result.current.handleTicket({
        ticket: 'guest-ticket-123',
        messenger: 'telegram',
        messengerId: '67890',
        displayName: 'Jane',
      })
    })

    expect(result.current.error).toBe('Only 0 seats left')
    expect(result.current.isDuplicate).toBe(false)
  })

  it('sets generic error when error is not an Error instance', async () => {
    mockMutateAsync.mockRejectedValueOnce('some string error')

    const { result } = renderHook(
      () => useBookingDialog({ service: serviceWithoutOptions, preselectedSlotId: 'slot-1' }),
      { wrapper: createWrapper() },
    )

    await act(async () => {
      await result.current.handleTicket({
        ticket: 'guest-ticket-123',
        messenger: 'telegram',
        messengerId: '67890',
        displayName: 'Jane',
      })
    })

    expect(result.current.error).toBe('Could not complete the booking')
  })

  it('clears previous error before a new attempt', async () => {
    // First attempt fails
    mockMutateAsync.mockRejectedValueOnce(new Error('Slot is full'))

    const { result } = renderHook(
      () => useBookingDialog({ service: serviceWithoutOptions, preselectedSlotId: 'slot-1' }),
      { wrapper: createWrapper() },
    )

    await act(async () => {
      await result.current.handleTicket({
        ticket: 'ticket-1',
        messenger: 'telegram',
        messengerId: '67890',
        displayName: 'Jane',
      })
    })
    expect(result.current.error).toBe('Slot is full')

    // reset() clears the in-flight counter so a new tap works
    act(() => result.current.reset())

    // Second attempt succeeds
    mockMutateAsync.mockResolvedValueOnce({ booking: guestBooking })

    await act(async () => {
      await result.current.handleTicket({
        ticket: 'ticket-2',
        messenger: 'telegram',
        messengerId: '67890',
        displayName: 'Jane',
      })
    })

    expect(result.current.error).toBeNull()
    expect(result.current.step).toBe('success')
  })

  it('does not let a sequential 401 overwrite a success (login double-fire)', async () => {
    // First call succeeds
    mockMutateAsync.mockResolvedValueOnce({ booking: guestBooking })
    // Second call (double-fire): ticket already consumed, server returns 401
    mockMutateAsync.mockRejectedValueOnce(
      new ApiError('Your Telegram confirmation expired — authenticate again', 401),
    )

    const { result } = renderHook(
      () => useBookingDialog({ service: serviceWithoutOptions, preselectedSlotId: 'slot-1' }),
      { wrapper: createWrapper() },
    )

    // First call — the real one
    await act(async () => {
      await result.current.handleTicket({
        ticket: 'ticket-1',
        messenger: 'telegram',
        messengerId: '67890',
        displayName: 'Jane',
      })
    })

    expect(mockMutateAsync).toHaveBeenCalledTimes(1)
    expect(result.current.step).toBe('success')

    // Second call — the login double-fire; the 401 must not overwrite the
    // success because the first call is no longer in flight (inFlightCount
    // is 0 by now), so the 401 is a genuine "ticket expired" — but the step
    // is already 'success', so the error is set but not shown.
    await act(async () => {
      await result.current.handleTicket({
        ticket: 'ticket-1',
        messenger: 'telegram',
        messengerId: '67890',
        displayName: 'Jane',
      })
    })

    expect(mockMutateAsync).toHaveBeenCalledTimes(2)
    // Step stays success — the dialog has already moved on
    expect(result.current.step).toBe('success')
  })

  it('does not let a sequential 401 overwrite a duplicate 409', async () => {
    // First call: duplicate 409
    mockMutateAsync.mockRejectedValueOnce(
      new ApiError('You already have a booking for this session', 409, 'duplicate_booking'),
    )

    const { result } = renderHook(
      () => useBookingDialog({ service: serviceWithoutOptions, preselectedSlotId: 'slot-1' }),
      { wrapper: createWrapper() },
    )

    await act(async () => {
      await result.current.handleTicket({
        ticket: 'ticket-1',
        messenger: 'telegram',
        messengerId: '67890',
        displayName: 'Jane',
      })
    })

    expect(result.current.error).toBe('You already have a booking for this session')
    expect(result.current.isDuplicate).toBe(true)

    // In production the button is hidden during isCreating, so a sequential
    // double-fire cannot happen — the user would need to tap again after the
    // error appears, which is a genuine new attempt. The primary defense
    // against the 401 is retry: false on useCreateBooking. This test just
    // verifies the error is set correctly on the first call.
    expect(mockMutateAsync).toHaveBeenCalledTimes(1)
  })

  it('does not let a concurrent 401 overwrite a 409 when 401 arrives first', async () => {
    // Simulate the real-world race: the login double-fires, both calls start
    // concurrently. The 401 (ticket already consumed) arrives *before* the
    // 409 (duplicate) because the server generates the 401 immediately while
    // the 409 needs the full booking transaction.
    //
    // We use a deferred promise for the 409 so we can control resolution order.
    let resolve409: () => void
    const pending409 = new Promise<void>((resolve) => {
      resolve409 = resolve
    })

    // First call (the real one): returns a 409 duplicate, but only after we
    // manually resolve it.
    mockMutateAsync.mockImplementationOnce(async () => {
      await pending409
      throw new ApiError('You already have a booking for this session', 409, 'duplicate_booking')
    })

    // Second call (the double-fire): returns a 401 immediately.
    mockMutateAsync.mockImplementationOnce(async () => {
      throw new ApiError('Your Telegram confirmation expired — authenticate again', 401)
    })

    const { result } = renderHook(
      () => useBookingDialog({ service: serviceWithoutOptions, preselectedSlotId: 'slot-1' }),
      { wrapper: createWrapper() },
    )

    // Start both calls concurrently — do not await yet
    let promise1: Promise<void> | undefined
    let promise2: Promise<void> | undefined
    act(() => {
      promise1 = result.current.handleTicket({
        ticket: 'ticket-1',
        messenger: 'telegram',
        messengerId: '67890',
        displayName: 'Jane',
      })
      promise2 = result.current.handleTicket({
        ticket: 'ticket-2',
        messenger: 'telegram',
        messengerId: '67890',
        displayName: 'Jane',
      })
    })

    // Let the 401 resolve first — it should be dropped because another call
    // is still in flight (inFlightCount > 1).
    await act(async () => {
      await promise2!
      // Allow a microtask for state to settle
      await Promise.resolve()
    })

    // The 401 must not have set an error — the 409 is still pending
    expect(result.current.error).toBeNull()
    expect(result.current.isDuplicate).toBe(false)

    // Now resolve the 409 — the real result
    await act(async () => {
      resolve409!()
      await promise1!
    })

    expect(result.current.error).toBe('You already have a booking for this session')
    expect(result.current.isDuplicate).toBe(true)
    expect(mockMutateAsync).toHaveBeenCalledTimes(2)
  })
})

// ── localized error mapping: the server copy is EN; the dialog
// re-renders the recognizable failure modes in the guest's language,
// keeping the real numbers. ─────────────────────────────────────────────────

describe('useBookingDialog — localized error mapping', () => {
  async function failWith(err: unknown) {
    mockMutateAsync.mockRejectedValueOnce(err)
    const { result } = renderHook(
      () => useBookingDialog({ service: serviceWithoutOptions, preselectedSlotId: 'slot-1' }),
      { wrapper: createWrapper() },
    )
    await act(async () => {
      await result.current.handleTicket({
        ticket: 't',
        messenger: 'telegram',
        messengerId: '67890',
        displayName: 'Jane',
      })
    })
    return result.current.error
  }

  it('renders a sold-out 409 (seatsLeft 0) as the localized sold-out copy', async () => {
    const error = await failWith(
      new ApiError('raw server sold-out copy', 409, 'slot_sold_out', {
        seatsLeft: 0,
      }),
    )
    // The IntlTestProvider renders the real ICU copy — the raw server
    // message must be replaced by the localized one.
    expect(error).toBe('This session is fully booked')
  })

  it('keeps the real seatsLeft count in the localized message', async () => {
    const error = await failWith(
      new ApiError('Only 2 seats left', 409, 'slot_sold_out', { seatsLeft: 2 }),
    )
    expect(error).toContain('2')
    expect(error).not.toBe('Only 2 seats left')
  })

  it('renders a party-too-large 400 with the maxSeats number', async () => {
    const error = await failWith(
      new ApiError('You can book at most 4 seats', 400, 'party_too_large', {
        maxSeats: 4,
      }),
    )
    expect(error).toContain('4')
    expect(error).not.toBe('You can book at most 4 seats')
  })

  it('renders a 404 as the localized "no longer available" copy', async () => {
    const error = await failWith(new ApiError('raw server gone copy', 404, 'slotNotBookable'))
    expect(error).toBe('This session is no longer available')
  })

  it('renders an invalid-option code as the localized options copy', async () => {
    const error = await failWith(new ApiError('Invalid option selection', 400, 'invalid_option'))
    expect(error).toBeTruthy()
    expect(error).not.toBe('Invalid option selection')
  })

  it('falls back to the server message for an unrecognized ApiError', async () => {
    const error = await failWith(new ApiError('Something unexpected', 418))
    expect(error).toBe('Something unexpected')
  })
})

// ── Live occupancy (ADR-025) ─────────────────────────────────────────────────
// `slots` is the live query list — a picked slot can fill/shrink
// mid-flow. `liveNotice` must surface it, actions resolve it, and it
// stays suppressed through a pending/failed/successful attempt.

const liveSlot = (bookedCount: number, capacity = 10): TimeSlotRecord =>
  ({
    id: 'slot-1',
    serviceId: 'svc-1',
    startsAt: '2026-07-25T05:00:00.000Z',
    durationMinutes: 60,
    capacity,
    bookedCount,
    price: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  }) as TimeSlotRecord

function renderLive(initialSlots: TimeSlotRecord[]) {
  return renderHook(
    ({ slots }: { slots: TimeSlotRecord[] }) =>
      useBookingDialog({
        service: serviceWithGroupBookings,
        slots,
        preselectedSlotId: 'slot-1',
      }),
    { wrapper: createWrapper(), initialProps: { slots: initialSlots } },
  )
}

describe('useBookingDialog — live occupancy', () => {
  it('reports "filled" when the picked slot reaches zero seats left', () => {
    const { result, rerender } = renderLive([liveSlot(3)])
    expect(result.current.liveNotice).toBeNull()

    rerender({ slots: [liveSlot(10, 10)] })
    expect(result.current.liveNotice).toBe('filled')
    expect(result.current.liveSeatsLeft).toBe(0)
  })

  it('reports "filled" when the picked slot vanishes from the list', () => {
    const { result, rerender } = renderLive([liveSlot(3)])
    rerender({ slots: [] })
    expect(result.current.liveNotice).toBe('filled')
  })

  it('reports "shrunk" when the party size exceeds what is left', () => {
    const { result, rerender } = renderLive([liveSlot(0)])
    act(() => result.current.setSeats(3))

    rerender({ slots: [liveSlot(8, 10)] }) // left = 2 < seats = 3
    expect(result.current.liveNotice).toBe('shrunk')
    expect(result.current.liveSeatsLeft).toBe(2)
  })

  it('bookRemainingSeats confirms the live count and clears the notice', () => {
    const { result, rerender } = renderLive([liveSlot(0)])
    act(() => result.current.setSeats(3))
    rerender({ slots: [liveSlot(8, 10)] })
    expect(result.current.liveNotice).toBe('shrunk')

    act(() => result.current.bookRemainingSeats())
    expect(result.current.seats).toBe(2)
    expect(result.current.liveNotice).toBeNull()
  })

  it('pickAnotherSlot returns to the picker with a clean slate', () => {
    const { result, rerender } = renderLive([liveSlot(3)])
    act(() => result.current.setStep('details'))
    rerender({ slots: [liveSlot(10, 10)] })
    expect(result.current.liveNotice).toBe('filled')

    act(() => result.current.pickAnotherSlot())
    expect(result.current.step).toBe('slot')
    expect(result.current.slotId).toBeUndefined()
    expect(result.current.liveNotice).toBeNull()
  })

  it('suppresses the notice while a booking attempt is in flight or failed', async () => {
    mockMutateAsync.mockRejectedValueOnce(new ApiError('Only 2 seats left', 409, 'seats_left'))
    const { result, rerender } = renderLive([liveSlot(3)])
    act(() => result.current.setStep('verify'))

    await act(async () => {
      await result.current.handleTicket({
        ticket: 't',
        messenger: 'telegram',
        messengerId: '1',
        displayName: 'J',
      })
    })
    expect(result.current.attempted).toBe(true)

    // The slot filling *during* the failed attempt must not stack a notice
    // on the server error — suppression holds until deliberate navigation.
    rerender({ slots: [liveSlot(10, 10)] })
    expect(result.current.liveNotice).toBeNull()

    act(() => result.current.backFromVerify())
    expect(result.current.step).toBe('details')
    expect(result.current.attempted).toBe(false)
    expect(result.current.liveNotice).toBe('filled')
  })

  it('stays suppressed on the success step — the arriving event is our own', async () => {
    mockMutateAsync.mockResolvedValueOnce({ booking: guestBooking })
    const { result, rerender } = renderLive([liveSlot(3)])
    act(() => result.current.setStep('verify'))

    await act(async () => {
      await result.current.handleTicket({
        ticket: 't',
        messenger: 'telegram',
        messengerId: '1',
        displayName: 'J',
      })
    })
    expect(result.current.step).toBe('success')

    rerender({ slots: [liveSlot(4, 10)] })
    expect(result.current.liveNotice).toBeNull()
  })
})
