import { DEFAULT_LOCALE } from '@repo/contracts'
import type { Booking, Organizer, Service, TimeSlot } from '@repo/db'
import { describe, expect, it } from 'vitest'

import {
  bookingCancelledForGuest,
  bookingCancelledForOrganizer,
  bookingCreatedForGuest,
  bookingCreatedForOrganizer,
  describeActor,
  escapeHtml,
  notificationLocale,
} from './templates'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const organizer = {
  id: 'org-1',
  slug: 'yoga-studio',
  name: 'Yoga Studio',
  timezone: 'Europe/Belgrade',
  messenger: 'telegram',
  messengerId: '12345',
  language: DEFAULT_LOCALE,
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
  maxSeatsPerBooking: 1,
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
  guestLocale: DEFAULT_LOCALE,
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

// ── notificationLocale ────────────────────────────────────────────────────────

describe('notificationLocale', () => {
  it('uses the organizer language for the organizer', () => {
    const ruView = {
      ...view,
      organizer: { ...organizer, language: 'ru' } as Organizer,
    }
    expect(notificationLocale('organizer', ruView)).toBe('ru')
  })

  it('uses the guest locale for the guest', () => {
    const ruView = {
      ...view,
      booking: { ...booking, guestLocale: 'ru' } as Booking,
    }
    expect(notificationLocale('guest', ruView)).toBe('ru')
  })

  it('falls back to English for unknown stored values', () => {
    const badView = {
      ...view,
      organizer: { ...organizer, language: 'fr' } as Organizer,
      booking: { ...booking, guestLocale: 'it' } as Booking,
    }
    expect(notificationLocale('organizer', badView)).toBe(DEFAULT_LOCALE)
    expect(notificationLocale('guest', badView)).toBe(DEFAULT_LOCALE)
  })
})

// ── bookingCreatedForOrganizer ────────────────────────────────────────────────

describe('bookingCreatedForOrganizer', () => {
  it('contains the guest name', () => {
    const msg = bookingCreatedForOrganizer(view, 'https://app/cabinet', DEFAULT_LOCALE)
    expect(msg.text).toContain('Jane Doe')
  })

  it('contains the service title', () => {
    const msg = bookingCreatedForOrganizer(view, 'https://app/cabinet', DEFAULT_LOCALE)
    expect(msg.text).toContain('Morning Yoga')
  })

  it('contains the seats label', () => {
    const msg = bookingCreatedForOrganizer(view, 'https://app/cabinet', DEFAULT_LOCALE)
    expect(msg.text).toContain('1 seat')
  })

  it('shows "now full" when the slot is full', () => {
    const fullView = {
      ...view,
      slot: { ...slot, bookedCount: 10, capacity: 10 } as TimeSlot,
    }
    const msg = bookingCreatedForOrganizer(fullView, 'https://app/cabinet', DEFAULT_LOCALE)
    expect(msg.text).toContain('now full')
  })

  it('shows seats still free when not full', () => {
    const msg = bookingCreatedForOrganizer(view, 'https://app/cabinet', DEFAULT_LOCALE)
    expect(msg.text).toContain('still free')
  })

  it('has the cabinet URL as button', () => {
    const msg = bookingCreatedForOrganizer(view, 'https://app/cabinet', DEFAULT_LOCALE)
    expect(msg.button?.url).toBe('https://app/cabinet')
    expect(msg.button?.text).toBe('Open in cabinet')
  })

  it('escapes HTML in the guest name', () => {
    const xssView = {
      ...view,
      booking: { ...booking, guestName: '<script>alert(1)</script>' } as Booking,
    }
    const msg = bookingCreatedForOrganizer(xssView, 'https://app/cabinet', DEFAULT_LOCALE)
    expect(msg.text).not.toContain('<script>')
    expect(msg.text).toContain('&lt;script&gt;')
  })

  it('renders the Russian copy with correct plural forms', () => {
    const ruView = { ...view, organizer: { ...organizer, language: 'ru' } as Organizer }

    const one = bookingCreatedForOrganizer({ ...ruView, booking: { ...booking, seats: 1 } }, 'u', 'ru')
    expect(one.text).toContain('Новое бронирование')
    expect(one.text).toContain('1 место')

    const few = bookingCreatedForOrganizer({ ...ruView, booking: { ...booking, seats: 2 } }, 'u', 'ru')
    expect(few.text).toContain('2 места')

    const many = bookingCreatedForOrganizer({ ...ruView, booking: { ...booking, seats: 5 } }, 'u', 'ru')
    expect(many.text).toContain('5 мест')
  })

  it('renders the Spanish copy with correct plural forms', () => {
    const esView = { ...view, organizer: { ...organizer, language: 'es' } as Organizer }

    const one = bookingCreatedForOrganizer({ ...esView, booking: { ...booking, seats: 1 } }, 'u', 'es')
    expect(one.text).toContain('Nueva reserva')
    expect(one.text).toContain('1 plaza')

    const many = bookingCreatedForOrganizer({ ...esView, booking: { ...booking, seats: 2 } }, 'u', 'es')
    expect(many.text).toContain('2 plazas')
    expect(many.button?.text).toBe('Abrir en el panel')
  })

  it('renders the German copy with correct plural forms', () => {
    const deView = { ...view, organizer: { ...organizer, language: 'de' } as Organizer }

    const one = bookingCreatedForOrganizer({ ...deView, booking: { ...booking, seats: 1 } }, 'u', 'de')
    expect(one.text).toContain('Neue Buchung')
    expect(one.text).toContain('1 Platz')

    const many = bookingCreatedForOrganizer({ ...deView, booking: { ...booking, seats: 2 } }, 'u', 'de')
    expect(many.text).toContain('2 Plätze')
    expect(many.button?.text).toBe('Im Veranstalterbereich öffnen')
  })

  it('renders the Japanese copy with localized counters', () => {
    const jaView = { ...view, organizer: { ...organizer, language: 'ja' } as Organizer }

    const one = bookingCreatedForOrganizer({ ...jaView, booking: { ...booking, seats: 1 } }, 'u', 'ja')
    expect(one.text).toContain('新しい予約')
    expect(one.text).toContain('1名')

    const many = bookingCreatedForOrganizer({ ...jaView, booking: { ...booking, seats: 2 } }, 'u', 'ja')
    expect(many.text).toContain('2名')
    expect(many.button?.text).toBe('管理画面で開く')
  })
})

// ── bookingCreatedForGuest ────────────────────────────────────────────────────

describe('bookingCreatedForGuest', () => {
  it('contains the organizer name', () => {
    const msg = bookingCreatedForGuest(view, 'https://app/booking/token', DEFAULT_LOCALE)
    expect(msg.text).toContain('Yoga Studio')
  })

  it('contains the booking lines (service, date, seats)', () => {
    const msg = bookingCreatedForGuest(view, 'https://app/booking/token', DEFAULT_LOCALE)
    expect(msg.text).toContain('Morning Yoga')
    expect(msg.text).toContain('1 seat')
  })

  it('contains the location when set', () => {
    const msg = bookingCreatedForGuest(view, 'https://app/booking/token', DEFAULT_LOCALE)
    expect(msg.text).toContain('Studio A, Main Street')
  })

  it('has the manage URL as button', () => {
    const msg = bookingCreatedForGuest(view, 'https://app/booking/token', DEFAULT_LOCALE)
    expect(msg.button?.url).toBe('https://app/booking/token')
    expect(msg.button?.text).toBe('Manage my booking')
  })

  it('renders Russian with the guest locale', () => {
    const ruView = {
      ...view,
      booking: { ...booking, guestLocale: 'ru' } as Booking,
      organizer: { ...organizer, name: 'Студия «Лотос»' } as Organizer,
    }
    const msg = bookingCreatedForGuest(ruView, 'https://app/booking/token', 'ru')
    expect(msg.text).toContain('Бронирование подтверждено')
    expect(msg.text).toContain('Студия «Лотос»')
    expect(msg.button?.text).toBe('Управлять бронью')
  })

  it('renders Spanish with the guest locale', () => {
    const esView = {
      ...view,
      booking: { ...booking, guestLocale: 'es' } as Booking,
      organizer: { ...organizer, name: 'Estudio Loto' } as Organizer,
    }
    const msg = bookingCreatedForGuest(esView, 'https://app/booking/token', 'es')
    expect(msg.text).toContain('Reserva confirmada')
    expect(msg.text).toContain('Estudio Loto')
    expect(msg.button?.text).toBe('Gestionar mi reserva')
  })

  it('renders German with the guest locale', () => {
    const deView = {
      ...view,
      booking: { ...booking, guestLocale: 'de' } as Booking,
      organizer: { ...organizer, name: 'Studio Lotus' } as Organizer,
    }
    const msg = bookingCreatedForGuest(deView, 'https://app/booking/token', 'de')
    expect(msg.text).toContain('Buchung bestätigt')
    expect(msg.text).toContain('Studio Lotus')
    expect(msg.button?.text).toBe('Meine Buchung verwalten')
  })

  it('renders Japanese with the guest locale', () => {
    const jaView = {
      ...view,
      booking: { ...booking, guestLocale: 'ja' } as Booking,
      organizer: { ...organizer, name: 'ロータススタジオ' } as Organizer,
    }
    const msg = bookingCreatedForGuest(jaView, 'https://app/booking/token', 'ja')
    expect(msg.text).toContain('予約が確定しました')
    expect(msg.text).toContain('ロータススタジオ')
    expect(msg.button?.text).toBe('予約を管理')
  })
})

// ── bookingCancelledForOrganizer ─────────────────────────────────────────────

describe('bookingCancelledForOrganizer', () => {
  it('contains "Booking cancelled"', () => {
    const msg = bookingCancelledForOrganizer(view, 'https://app/cabinet', DEFAULT_LOCALE)
    expect(msg.text).toContain('Booking cancelled')
  })

  it('contains the seats-now-free line', () => {
    const msg = bookingCancelledForOrganizer(view, 'https://app/cabinet', DEFAULT_LOCALE)
    expect(msg.text).toContain('now free')
  })

  it('has the cabinet URL as button', () => {
    const msg = bookingCancelledForOrganizer(view, 'https://app/cabinet', DEFAULT_LOCALE)
    expect(msg.button?.url).toBe('https://app/cabinet')
  })

  it('renders Russian', () => {
    const ruView = { ...view, organizer: { ...organizer, language: 'ru' } as Organizer }
    const msg = bookingCancelledForOrganizer(ruView, 'https://app/cabinet', 'ru')
    expect(msg.text).toContain('Бронирование отменено')
    expect(msg.text).toContain('освободилось')
  })

  it('renders Spanish', () => {
    const esView = { ...view, organizer: { ...organizer, language: 'es' } as Organizer }
    const msg = bookingCancelledForOrganizer(esView, 'https://app/cabinet', 'es')
    expect(msg.text).toContain('Reserva cancelada')
    expect(msg.text).toContain('8 plazas libres')
    expect(msg.button?.text).toBe('Abrir en el panel')
  })

  it('renders German', () => {
    const deView = { ...view, organizer: { ...organizer, language: 'de' } as Organizer }
    const msg = bookingCancelledForOrganizer(deView, 'https://app/cabinet', 'de')
    expect(msg.text).toContain('Buchung storniert')
    expect(msg.text).toContain('8 Plätze')
    expect(msg.button?.text).toBe('Im Veranstalterbereich öffnen')
  })

  it('renders Japanese', () => {
    const jaView = { ...view, organizer: { ...organizer, language: 'ja' } as Organizer }
    const msg = bookingCancelledForOrganizer(jaView, 'https://app/cabinet', 'ja')
    expect(msg.text).toContain('予約がキャンセルされました')
    expect(msg.text).toContain('8枠')
    expect(msg.button?.text).toBe('管理画面で開く')
  })
})

// ── bookingCancelledForGuest ──────────────────────────────────────────────────

describe('bookingCancelledForGuest', () => {
  it('contains the organizer name', () => {
    const msg = bookingCancelledForGuest(view, 'https://app/yoga-studio', DEFAULT_LOCALE)
    expect(msg.text).toContain('Yoga Studio')
  })

  it('has "See other sessions" button with organizer URL', () => {
    const msg = bookingCancelledForGuest(view, 'https://app/yoga-studio', DEFAULT_LOCALE)
    expect(msg.button?.text).toBe('See other sessions')
    expect(msg.button?.url).toBe('https://app/yoga-studio')
  })

  it('does not include a manage link (booking is already cancelled)', () => {
    const msg = bookingCancelledForGuest(view, 'https://app/yoga-studio', DEFAULT_LOCALE)
    expect(msg.button?.text).not.toBe('Manage my booking')
  })

  it('renders Spanish', () => {
    const msg = bookingCancelledForGuest(view, 'https://app/yoga-studio', 'es')
    expect(msg.text).toContain('Tu reserva se ha cancelado')
    expect(msg.text).toContain('por Yoga Studio')
    expect(msg.button?.text).toBe('Ver otras sesiones')
  })

  it('renders German', () => {
    const msg = bookingCancelledForGuest(view, 'https://app/yoga-studio', 'de')
    expect(msg.text).toContain('Deine Buchung wurde storniert')
    expect(msg.text).toContain('von Yoga Studio')
    expect(msg.button?.text).toBe('Andere Termine ansehen')
  })

  it('renders Japanese', () => {
    const msg = bookingCancelledForGuest(view, 'https://app/yoga-studio', 'ja')
    expect(msg.text).toContain('予約がキャンセルされました')
    expect(msg.text).toContain('Yoga Studioによるキャンセル')
    expect(msg.button?.text).toBe('別の回を見る')
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
