import type { GuestBooking, ServiceRecord } from '@repo/api-contracts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useBookingDialog } from './use-booking-dialog'

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockRouterRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRouterRefresh, push: vi.fn() }),
}))

// Mock the entire @/lib/api module — we only need useCreateBooking
const mockMutateAsync = vi.fn()
vi.mock('@/lib/api', () => ({
  useCreateBooking: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}))

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
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
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
    })
    expect(result.current.step).toBe('success')
    expect(result.current.booking).toEqual(guestBooking)
    expect(result.current.error).toBeNull()
    expect(mockRouterRefresh).toHaveBeenCalled()
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
    expect(mockRouterRefresh).toHaveBeenCalled()
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
    expect(result.current.step).not.toBe('success')
    expect(result.current.booking).toBeNull()
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
})
