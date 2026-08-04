import type { Booking, Organizer, Service, TimeSlot } from '@repo/db'
import { describe, expect, it } from 'vitest'

import {
  bookingCancelledForGuest,
  bookingCancelledForOrganizer,
  bookingCreatedForGuest,
  bookingCreatedForOrganizer,
  describeActor,
  escapeHtml,
} from './templates'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const organizer = {
  id: 'org-1',
  slug: 'yoga-studio',
  name: 'Yoga Studio',
  timezone: 'Europe/Belgrade',
  messenger: 'telegram',
  messengerId: '12345',
  description: null,
  photoUrl: null,
  location: 'Studio A, Main Street',
  contact: '+381 60 123 4567',
  createdAt: new Date('2026-01-01'),
} as Organizer

const service = {
  id: 'svc-1',
  organizerId: 'org-1',
  title: 'Morning Yoga',
  description: 'Start your day right',
  photoUrl: null,
  location: null,
  contact: null,
  defaultPrice: '€15',
  defaultCapacity: 10,
  defaultDurationMinutes: 60,
  options: ['Beginner', 'Intermediate'],
  optionsSelectMode: 'single',
  createdAt: new Date('2026-01-01'),
} as Service

const slot = {
  id: 'slot-1',
  serviceId: 'svc-1',
  startsAt: new Date('2026-07-25T05:00:00.000Z'),
  durationMinutes: 60,
  capacity: 10,
  bookedCount: 2,
  price: null,
  createdAt: new Date('2026-01-01'),
} as TimeSlot

const booking = {
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
  createdAt: new Date('2026-07-20T10:00:00.000Z'),
} as Booking

const view = { booking, slot, service, organizer }

// ── escapeHtml ────────────────────────────────────────────────────────────────

describe('escapeHtml', () => {
  it('escapes ampersand', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b')
  })

  it('escapes less-than', () => {
    expect(escapeHtml('a < b')).toBe('a &lt; b')
  })

  it('escapes greater-than', () => {
    expect(escapeHtml('a > b')).toBe('a &gt; b')
  })

  it('escapes double quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;')
  })

  it('escapes single quotes', () => {
    expect(escapeHtml("it's")).toBe('it&#39;s')
  })

  it('escapes all five characters together', () => {
    expect(escapeHtml('<script>alert("x") & \'y\'</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;',
    )
  })

  it('leaves plain text unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world')
  })
})

// ── bookingCreatedForOrganizer ────────────────────────────────────────────────

describe('bookingCreatedForOrganizer', () => {
  it('contains the guest name', () => {
    const msg = bookingCreatedForOrganizer(view, 'https://app/cabinet')
    expect(msg.text).toContain('Jane Doe')
  })

  it('contains the service title', () => {
    const msg = bookingCreatedForOrganizer(view, 'https://app/cabinet')
    expect(msg.text).toContain('Morning Yoga')
  })

  it('contains the seats label', () => {
    const msg = bookingCreatedForOrganizer(view, 'https://app/cabinet')
    expect(msg.text).toContain('1 seat')
  })

  it('shows "now full" when the slot is full', () => {
    const fullView = {
      ...view,
      slot: { ...slot, bookedCount: 10, capacity: 10 } as TimeSlot,
    }
    const msg = bookingCreatedForOrganizer(fullView, 'https://app/cabinet')
    expect(msg.text).toContain('now full')
  })

  it('shows seats still free when not full', () => {
    const msg = bookingCreatedForOrganizer(view, 'https://app/cabinet')
    expect(msg.text).toContain('still free')
  })

  it('has the cabinet URL as button', () => {
    const msg = bookingCreatedForOrganizer(view, 'https://app/cabinet')
    expect(msg.button?.url).toBe('https://app/cabinet')
    expect(msg.button?.text).toBe('Open in cabinet')
  })

  it('escapes HTML in the guest name', () => {
    const xssView = {
      ...view,
      booking: { ...booking, guestName: '<script>alert(1)</script>' } as Booking,
    }
    const msg = bookingCreatedForOrganizer(xssView, 'https://app/cabinet')
    expect(msg.text).not.toContain('<script>')
    expect(msg.text).toContain('&lt;script&gt;')
  })
})

// ── bookingCreatedForGuest ────────────────────────────────────────────────────

describe('bookingCreatedForGuest', () => {
  it('contains the organizer name', () => {
    const msg = bookingCreatedForGuest(view, 'https://app/booking/token')
    expect(msg.text).toContain('Yoga Studio')
  })

  it('contains the booking lines (service, date, seats)', () => {
    const msg = bookingCreatedForGuest(view, 'https://app/booking/token')
    expect(msg.text).toContain('Morning Yoga')
    expect(msg.text).toContain('1 seat')
  })

  it('contains the location when set', () => {
    const msg = bookingCreatedForGuest(view, 'https://app/booking/token')
    expect(msg.text).toContain('Studio A, Main Street')
  })

  it('has the manage URL as button', () => {
    const msg = bookingCreatedForGuest(view, 'https://app/booking/token')
    expect(msg.button?.url).toBe('https://app/booking/token')
    expect(msg.button?.text).toBe('Manage my booking')
  })
})

// ── bookingCancelledForOrganizer ─────────────────────────────────────────────

describe('bookingCancelledForOrganizer', () => {
  it('contains "Booking cancelled"', () => {
    const msg = bookingCancelledForOrganizer(view, 'https://app/cabinet')
    expect(msg.text).toContain('Booking cancelled')
  })

  it('contains the seats-now-free line', () => {
    const msg = bookingCancelledForOrganizer(view, 'https://app/cabinet')
    expect(msg.text).toContain('now free')
  })

  it('has the cabinet URL as button', () => {
    const msg = bookingCancelledForOrganizer(view, 'https://app/cabinet')
    expect(msg.button?.url).toBe('https://app/cabinet')
  })
})

// ── bookingCancelledForGuest ──────────────────────────────────────────────────

describe('bookingCancelledForGuest', () => {
  it('contains the organizer name', () => {
    const msg = bookingCancelledForGuest(view, 'https://app/yoga-studio')
    expect(msg.text).toContain('Yoga Studio')
  })

  it('has "See other sessions" button with organizer URL', () => {
    const msg = bookingCancelledForGuest(view, 'https://app/yoga-studio')
    expect(msg.button?.text).toBe('See other sessions')
    expect(msg.button?.url).toBe('https://app/yoga-studio')
  })

  it('does not include a manage link (booking is already cancelled)', () => {
    const msg = bookingCancelledForGuest(view, 'https://app/yoga-studio')
    expect(msg.button?.text).not.toBe('Manage my booking')
  })
})

// ── describeActor ─────────────────────────────────────────────────────────────

describe('describeActor', () => {
  it('returns "the guest" for guest', () => {
    expect(describeActor('guest')).toBe('the guest')
  })

  it('returns "the organizer" for organizer', () => {
    expect(describeActor('organizer')).toBe('the organizer')
  })
})
