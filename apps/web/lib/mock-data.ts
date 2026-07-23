// Mock data for CountMeIn design mockups.
// Shapes follow docs/domain.md (Organizer, Service, TimeSlot, Booking).
// This is static demo content only — no backend.

export type OptionsSelectMode = 'single' | 'multi'
export type BookingStatus = 'confirmed' | 'cancelled'

export interface Organizer {
  id: string
  slug: string
  name: string
  phone: string
  timezone: string
  description: string
  photoUrl: string
  messenger: string
  createdAt: string
}

export interface Service {
  id: string
  organizerId: string
  title: string
  description: string
  photoUrl: string
  defaultPrice: string
  defaultCapacity: number
  defaultDurationMinutes: number
  options?: string[]
  optionsSelectMode?: OptionsSelectMode
  createdAt: string
}

export interface TimeSlot {
  id: string
  serviceId: string
  startsAt: string // ISO
  durationMinutes: number
  capacity: number
  bookedCount: number
  price?: string
}

export interface Booking {
  id: string
  timeSlotId: string
  status: BookingStatus
  seats: number
  guestName: string
  guestPhone: string
  messenger: string
  manageToken: string
  selectedOptions?: string[]
  createdAt: string
}

export const organizer: Organizer = {
  id: 'org_1',
  slug: 'studio-lumen',
  name: 'Studio Lumen',
  phone: '+381641234567',
  timezone: 'Europe/Belgrade',
  description:
    'Boutique movement studio in the heart of Belgrade. Small-group yoga, breathwork, and pottery. Come as you are — beginners always welcome.',
  photoUrl: '/organizer-avatar.png',
  messenger: 'telegram',
  createdAt: '2024-11-02T09:00:00.000Z',
}

export const services: Service[] = [
  {
    id: 'svc_yoga',
    organizerId: 'org_1',
    title: 'Morning Vinyasa Flow',
    description:
      'A dynamic 60-minute flow to wake up the body and mind. Suitable for all levels. Mats and props provided.',
    photoUrl: '/service-yoga.png',
    defaultPrice: '1200 RSD',
    defaultCapacity: 12,
    defaultDurationMinutes: 60,
    options: ['Downtown studio', 'Riverside studio'],
    optionsSelectMode: 'single',
    createdAt: '2024-11-05T09:00:00.000Z',
  },
  {
    id: 'svc_pottery',
    organizerId: 'org_1',
    title: 'Hand-Building Pottery Workshop',
    description:
      'Shape your own mug or bowl from scratch. All clay, tools, and firing included. Great for a creative afternoon with friends.',
    photoUrl: '/service-pottery.png',
    defaultPrice: 'from 2500 RSD',
    defaultCapacity: 8,
    defaultDurationMinutes: 120,
    options: ['Bring a friend (+1 seat)', 'Take-home glaze kit', 'Photo of your piece'],
    optionsSelectMode: 'multi',
    createdAt: '2024-11-08T09:00:00.000Z',
  },
  {
    id: 'svc_breath',
    organizerId: 'org_1',
    title: 'Evening Breathwork Circle',
    description:
      'A calming 45-minute guided breathwork session to close out your day. Dim lights, warm blankets, deep rest.',
    photoUrl: '/service-breathwork.png',
    defaultPrice: '900 RSD',
    defaultCapacity: 16,
    defaultDurationMinutes: 45,
    createdAt: '2024-11-12T09:00:00.000Z',
  },
]

// Helper to build ISO datetimes relative to a fixed demo "now".
export const DEMO_NOW = new Date('2026-07-22T07:00:00.000Z')

function iso(daysFromNow: number, hour: number, minute = 0): string {
  const d = new Date(DEMO_NOW)
  d.setUTCDate(d.getUTCDate() + daysFromNow)
  d.setUTCHours(hour, minute, 0, 0)
  return d.toISOString()
}

export const slots: TimeSlot[] = [
  // Yoga
  { id: 'slot_y1', serviceId: 'svc_yoga', startsAt: iso(0, 7), durationMinutes: 60, capacity: 12, bookedCount: 9 },
  { id: 'slot_y2', serviceId: 'svc_yoga', startsAt: iso(1, 7), durationMinutes: 60, capacity: 12, bookedCount: 12 },
  { id: 'slot_y3', serviceId: 'svc_yoga', startsAt: iso(2, 7), durationMinutes: 60, capacity: 12, bookedCount: 4 },
  { id: 'slot_y4', serviceId: 'svc_yoga', startsAt: iso(3, 7), durationMinutes: 60, capacity: 12, bookedCount: 1, price: '1400 RSD' },
  // Pottery
  { id: 'slot_p1', serviceId: 'svc_pottery', startsAt: iso(1, 15), durationMinutes: 120, capacity: 8, bookedCount: 5 },
  { id: 'slot_p2', serviceId: 'svc_pottery', startsAt: iso(4, 15), durationMinutes: 120, capacity: 8, bookedCount: 8 },
  { id: 'slot_p3', serviceId: 'svc_pottery', startsAt: iso(6, 11), durationMinutes: 120, capacity: 8, bookedCount: 2 },
  // Breathwork
  { id: 'slot_b1', serviceId: 'svc_breath', startsAt: iso(0, 18), durationMinutes: 45, capacity: 16, bookedCount: 11 },
  { id: 'slot_b2', serviceId: 'svc_breath', startsAt: iso(2, 18), durationMinutes: 45, capacity: 16, bookedCount: 16 },
  { id: 'slot_b3', serviceId: 'svc_breath', startsAt: iso(5, 18), durationMinutes: 45, capacity: 16, bookedCount: 6 },
]

export const bookings: Booking[] = [
  {
    id: 'bk_1',
    timeSlotId: 'slot_y1',
    status: 'confirmed',
    seats: 2,
    guestName: 'Mila Petrović',
    guestPhone: '+381641112233',
    messenger: 'telegram',
    manageToken: 'demo-manage-token',
    selectedOptions: ['Downtown studio'],
    createdAt: '2026-07-20T10:12:00.000Z',
  },
  {
    id: 'bk_2',
    timeSlotId: 'slot_p1',
    status: 'confirmed',
    seats: 1,
    guestName: 'Noah Ellis',
    guestPhone: '+381641445566',
    messenger: 'telegram',
    manageToken: 'demo-manage-token-2',
    selectedOptions: ['Take-home glaze kit', 'Photo of your piece'],
    createdAt: '2026-07-19T18:40:00.000Z',
  },
  {
    id: 'bk_3',
    timeSlotId: 'slot_b1',
    status: 'confirmed',
    seats: 1,
    guestName: 'Ana Kovač',
    guestPhone: '+381641778899',
    messenger: 'telegram',
    manageToken: 'demo-manage-token-3',
    createdAt: '2026-07-21T08:05:00.000Z',
  },
  {
    id: 'bk_4',
    timeSlotId: 'slot_y3',
    status: 'confirmed',
    seats: 3,
    guestName: 'Luka Jovanović',
    guestPhone: '+381641223344',
    messenger: 'telegram',
    manageToken: 'demo-manage-token-4',
    selectedOptions: ['Riverside studio'],
    createdAt: '2026-07-21T11:20:00.000Z',
  },
  {
    id: 'bk_5',
    timeSlotId: 'slot_p1',
    status: 'cancelled',
    seats: 1,
    guestName: 'Sara Nikolić',
    guestPhone: '+381641556677',
    messenger: 'telegram',
    manageToken: 'demo-manage-token-5',
    createdAt: '2026-07-18T14:00:00.000Z',
  },
]

// --- Derived helpers ---

export function getService(serviceId: string): Service | undefined {
  return services.find((s) => s.id === serviceId)
}

export function getSlotsForService(serviceId: string): TimeSlot[] {
  return slots
    .filter((s) => s.serviceId === serviceId)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
}

export function getSlot(slotId: string): TimeSlot | undefined {
  return slots.find((s) => s.id === slotId)
}

/**
 * A booking reaches its service transitively (Booking → TimeSlot → Service),
 * mirroring docs/domain.md — there is no Booking.serviceId column.
 */
export function getBookingService(booking: Booking): Service | undefined {
  const slot = getSlot(booking.timeSlotId)
  return slot ? getService(slot.serviceId) : undefined
}

export function seatsLeft(slot: TimeSlot): number {
  return Math.max(0, slot.capacity - slot.bookedCount)
}

// --- Formatting helpers (fixed timezone for deterministic mockups) ---

const TZ = organizer.timezone

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: TZ,
  })
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: TZ,
  })
}

export function formatDateTime(iso: string): string {
  return `${formatDate(iso)} · ${formatTime(iso)}`
}

export function slotEnd(slot: TimeSlot): string {
  const start = new Date(slot.startsAt)
  const end = new Date(start.getTime() + slot.durationMinutes * 60_000)
  return end.toISOString()
}

export function slotPrice(slot: TimeSlot): string {
  const svc = getService(slot.serviceId)
  return slot.price ?? svc?.defaultPrice ?? ''
}

export function fillLabel(slot: TimeSlot): 'open' | 'filling' | 'full' {
  const left = seatsLeft(slot)
  if (left === 0) return 'full'
  if (left <= Math.ceil(slot.capacity * 0.25)) return 'filling'
  return 'open'
}
