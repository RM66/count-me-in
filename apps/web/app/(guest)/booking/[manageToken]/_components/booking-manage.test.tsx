import type { GuestBooking } from '@repo/api-contracts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BookingManage } from './booking-manage'

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockRouterRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRouterRefresh }),
}))

const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

const mockMutateAsync = vi.fn()
vi.mock('@/lib/api', () => ({
  useCancelBooking: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}))

// Mock AddToCalendar to avoid rendering the dropdown
vi.mock('@/app/(guest)/_components/add-to-calendar', () => ({
  AddToCalendar: ({ title }: { title: string }) => <div data-testid="add-to-calendar">{title}</div>,
}))

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeBooking(overrides: Partial<GuestBooking> = {}): GuestBooking {
  return {
    id: 'booking-1',
    status: 'confirmed',
    seats: 1,
    guestName: 'Alice Smith',
    selectedOptions: null,
    createdAt: '2025-01-01T10:00:00.000Z',
    manageToken: 'manage-token-abc',
    slot: {
      id: 'slot-1',
      serviceId: 'service-1',
      startsAt: '2025-06-15T10:00:00.000Z',
      durationMinutes: 60,
      capacity: 10,
      bookedCount: 3,
      price: null,
      createdAt: '2025-01-01T10:00:00.000Z',
    },
    service: {
      id: 'service-1',
      organizerId: 'org-1',
      title: 'Morning Yoga',
      description: null,
      photoUrl: null,
      location: null,
      contact: null,
      defaultPrice: '15 EUR',
      defaultCapacity: 10,
      defaultDurationMinutes: 60,
      maxSeatsPerBooking: 1,
      options: null,
      optionsSelectMode: null,
      createdAt: '2025-01-01T10:00:00.000Z',
    },
    organizer: {
      id: 'org-1',
      slug: 'yoga-studio',
      name: 'Sunrise Yoga Studio',
      timezone: 'Europe/Belgrade',
      description: null,
      photoUrl: null,
      location: 'Studio 5, Main Street',
      contact: '+381 60 123 4567',
      isDemo: false,
    },
    ...overrides,
  }
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('BookingManage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('confirmed booking rendering', () => {
    it('renders the service title', () => {
      renderWithProviders(<BookingManage booking={makeBooking()} />)
      // The title appears in both the card title and the AddToCalendar mock
      const elements = screen.getAllByText('Morning Yoga')
      expect(elements.length).toBeGreaterThanOrEqual(1)
    })

    it('shows a Confirmed badge', () => {
      renderWithProviders(<BookingManage booking={makeBooking()} />)
      expect(screen.getByText('Confirmed')).toBeInTheDocument()
    })

    it('renders the guest name', () => {
      renderWithProviders(<BookingManage booking={makeBooking()} />)
      expect(screen.getByText('Alice Smith')).toBeInTheDocument()
    })

    it('renders the price from the service default', () => {
      renderWithProviders(<BookingManage booking={makeBooking()} />)
      expect(screen.getByText('15 EUR')).toBeInTheDocument()
    })

    it('renders the duration', () => {
      renderWithProviders(<BookingManage booking={makeBooking()} />)
      expect(screen.getByText(/60 min/)).toBeInTheDocument()
    })

    it('renders the AddToCalendar component', () => {
      renderWithProviders(<BookingManage booking={makeBooking()} />)
      expect(screen.getByTestId('add-to-calendar')).toHaveTextContent('Morning Yoga')
    })

    it('renders the Cancel booking button', () => {
      renderWithProviders(<BookingManage booking={makeBooking()} />)
      expect(screen.getByText('Cancel booking')).toBeInTheDocument()
    })

    it('renders the organizer name in the description', () => {
      renderWithProviders(<BookingManage booking={makeBooking()} />)
      expect(screen.getByText(/Sunrise Yoga Studio/)).toBeInTheDocument()
    })
  })

  describe('location and contact', () => {
    it('renders the effective location', () => {
      renderWithProviders(<BookingManage booking={makeBooking()} />)
      expect(screen.getByText('Where')).toBeInTheDocument()
      expect(screen.getByText('Studio 5, Main Street')).toBeInTheDocument()
    })

    it('renders the effective contact as a ContactLink', () => {
      renderWithProviders(<BookingManage booking={makeBooking()} />)
      const link = screen.getByRole('link', { name: '+381 60 123 4567' })
      expect(link).toHaveAttribute('href', 'tel:+381601234567')
    })

    it('uses service location when set (overrides organizer)', () => {
      const booking = makeBooking({
        service: {
          ...makeBooking().service,
          location: 'Park Entrance',
          contact: 'park@example.com',
        },
        organizer: {
          ...makeBooking().organizer,
          location: 'Studio 5',
          contact: '+381 60 123 4567',
        },
      })
      renderWithProviders(<BookingManage booking={booking} />)
      expect(screen.getByText('Park Entrance')).toBeInTheDocument()
      expect(screen.getByText('park@example.com')).toBeInTheDocument()
      expect(screen.queryByText('Studio 5')).not.toBeInTheDocument()
    })

    it('hides location and contact section when neither is set', () => {
      const booking = makeBooking({
        service: { ...makeBooking().service, location: null, contact: null },
        organizer: { ...makeBooking().organizer, location: null, contact: null },
      })
      renderWithProviders(<BookingManage booking={booking} />)
      expect(screen.queryByText('Where')).not.toBeInTheDocument()
      expect(screen.queryByText('Contact')).not.toBeInTheDocument()
    })
  })

  describe('selected options', () => {
    it('renders selected options as badges', () => {
      renderWithProviders(
        <BookingManage booking={makeBooking({ selectedOptions: ['Mat', 'Bolster'] })} />,
      )
      expect(screen.getByText('Mat')).toBeInTheDocument()
      expect(screen.getByText('Bolster')).toBeInTheDocument()
      expect(screen.getByText('Options:')).toBeInTheDocument()
    })

    it('hides the options section when null', () => {
      renderWithProviders(<BookingManage booking={makeBooking({ selectedOptions: null })} />)
      expect(screen.queryByText('Options:')).not.toBeInTheDocument()
    })

    it('hides the options section when empty', () => {
      renderWithProviders(<BookingManage booking={makeBooking({ selectedOptions: [] })} />)
      expect(screen.queryByText('Options:')).not.toBeInTheDocument()
    })
  })

  describe('cancelled booking', () => {
    it('shows a Cancelled badge', () => {
      renderWithProviders(<BookingManage booking={makeBooking({ status: 'cancelled' })} />)
      expect(screen.getByText('Cancelled')).toBeInTheDocument()
    })

    it('shows the cancellation message', () => {
      renderWithProviders(<BookingManage booking={makeBooking({ status: 'cancelled' })} />)
      expect(
        screen.getByText('This booking was cancelled and the seat has been released.'),
      ).toBeInTheDocument()
    })

    it('shows a Book another time link pointing to the organizer page', () => {
      renderWithProviders(<BookingManage booking={makeBooking({ status: 'cancelled' })} />)
      const link = screen.getByRole('link', { name: 'Book another time' })
      expect(link).toHaveAttribute('href', '/yoga-studio')
    })

    it('does not show the Cancel booking button', () => {
      renderWithProviders(<BookingManage booking={makeBooking({ status: 'cancelled' })} />)
      expect(screen.queryByText('Cancel booking')).not.toBeInTheDocument()
    })

    it('does not show the AddToCalendar component', () => {
      renderWithProviders(<BookingManage booking={makeBooking({ status: 'cancelled' })} />)
      expect(screen.queryByTestId('add-to-calendar')).not.toBeInTheDocument()
    })
  })

  describe('cancel flow', () => {
    it('opens the confirmation dialog when Cancel booking is clicked', () => {
      renderWithProviders(<BookingManage booking={makeBooking()} />)
      fireEvent.click(screen.getByText('Cancel booking'))
      expect(screen.getByText('Cancel this booking?')).toBeInTheDocument()
    })

    it('calls mutateAsync with the manageToken and updates state on success', async () => {
      const cancelledBooking = makeBooking({ status: 'cancelled' })
      mockMutateAsync.mockResolvedValueOnce({ booking: cancelledBooking })

      renderWithProviders(<BookingManage booking={makeBooking()} />)

      // Open dialog
      fireEvent.click(screen.getByText('Cancel booking'))
      // Confirm
      fireEvent.click(screen.getByText('Yes, cancel'))

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith('manage-token-abc')
      })

      // Should now show cancelled state
      await waitFor(() => {
        expect(screen.getByText('Cancelled')).toBeInTheDocument()
        expect(screen.getByText('Book another time')).toBeInTheDocument()
      })

      expect(mockToastSuccess).toHaveBeenCalledWith('Booking cancelled')
      expect(mockRouterRefresh).toHaveBeenCalled()
    })

    it('shows an error toast on failure', async () => {
      mockMutateAsync.mockRejectedValueOnce(new Error('Already cancelled'))

      renderWithProviders(<BookingManage booking={makeBooking()} />)

      fireEvent.click(screen.getByText('Cancel booking'))
      fireEvent.click(screen.getByText('Yes, cancel'))

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith('Already cancelled')
      })

      // Should still be in confirmed state
      expect(screen.getByText('Confirmed')).toBeInTheDocument()
      expect(mockToastSuccess).not.toHaveBeenCalled()
    })

    it('shows a generic error message for non-Error exceptions', async () => {
      mockMutateAsync.mockRejectedValueOnce('something went wrong')

      renderWithProviders(<BookingManage booking={makeBooking()} />)

      fireEvent.click(screen.getByText('Cancel booking'))
      fireEvent.click(screen.getByText('Yes, cancel'))

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith('Could not cancel the booking')
      })
    })

    it('closes the dialog when Keep booking is clicked', () => {
      renderWithProviders(<BookingManage booking={makeBooking()} />)

      fireEvent.click(screen.getByText('Cancel booking'))
      expect(screen.getByText('Cancel this booking?')).toBeInTheDocument()

      fireEvent.click(screen.getByText('Keep booking'))
      expect(screen.queryByText('Cancel this booking?')).not.toBeInTheDocument()
    })
  })
})
