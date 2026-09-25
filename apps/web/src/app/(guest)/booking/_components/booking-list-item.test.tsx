import type { GuestBooking } from '@repo/contracts'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { IntlTestProvider } from '@/i18n/test-provider'
import { BookingListItem } from './booking-list-item'

// The lookup row links to the management page only while the booking is
// actionable; an expired token answers 404 there, so offering the link
// would be a dead end. The row itself always renders — booking history
// (including cancellations) must never disappear from the list.

function makeBooking(overrides: Partial<GuestBooking> = {}): GuestBooking {
  return {
    id: 'booking-1',
    status: 'confirmed',
    seats: 1,
    guestName: 'Alice Smith',
    selectedOptions: null,
    createdAt: '2025-01-01T10:00:00.000Z',
    manageToken: 'manage-token-abc',
    canCancel: true,
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

function renderItem(booking: GuestBooking) {
  return render(
    <IntlTestProvider>
      <BookingListItem booking={booking} />
    </IntlTestProvider>,
  )
}

describe('BookingListItem', () => {
  it('links to the management page while the token is live', () => {
    renderItem(makeBooking())
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/booking/manage-token-abc')
    expect(screen.getByText('Morning Yoga')).toBeInTheDocument()
  })

  it('keeps the row but drops the dead link for an expired token', () => {
    renderItem(makeBooking({ canCancel: false }))
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Morning Yoga')).toBeInTheDocument()
  })

  it('keeps a cancelled booking listed without a link', () => {
    renderItem(makeBooking({ status: 'cancelled', canCancel: false }))
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Morning Yoga')).toBeInTheDocument()
  })
})
