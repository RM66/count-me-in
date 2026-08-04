/**
 * Demo organizer seed data (ADR-010).
 *
 * Originally ported from `apps/web/lib/mock-data.ts` (deleted 2026-08-02) so the
 * public example page is backed by real rows and exercises the same queries as
 * any other organizer. This is now the **only** copy of the sample content.
 *
 * Two rules keep this seed usable long-term:
 *
 * 1. **Deterministic ids.** Re-seeding replaces rows in place instead of
 *    accumulating duplicates, and demo links stay stable.
 * 2. **Slot times relative to seed time**, never absolute. The old mock pinned
 *    `DEMO_NOW` to a fixed date, so every demo slot silently drifted into the
 *    past. Offsets are resolved against `now` at seed/refresh time instead.
 */

import { DEMO_ORGANIZER_ID, DEMO_ORGANIZER_SLUG, DEMO_SERVICE_IDS } from '@repo/api-contracts'

/** Deterministic demo slot ids (uuid — `time_slots.id` is a uuid column). */
const DEMO_SLOT_IDS = {
  y1: '01930000-0000-7000-8000-0000000a0001',
  y2: '01930000-0000-7000-8000-0000000a0002',
  y3: '01930000-0000-7000-8000-0000000a0003',
  y4: '01930000-0000-7000-8000-0000000a0004',
  p1: '01930000-0000-7000-8000-0000000b0001',
  p2: '01930000-0000-7000-8000-0000000b0002',
  p3: '01930000-0000-7000-8000-0000000b0003',
  b1: '01930000-0000-7000-8000-0000000c0001',
  b2: '01930000-0000-7000-8000-0000000c0002',
  b3: '01930000-0000-7000-8000-0000000c0003',
} as const

/** Deterministic demo booking ids. */
const DEMO_BOOKING_IDS = {
  b1: '01930000-0000-7000-8000-0000000d0001',
  b2: '01930000-0000-7000-8000-0000000d0002',
  b3: '01930000-0000-7000-8000-0000000d0003',
  b4: '01930000-0000-7000-8000-0000000d0004',
  b5: '01930000-0000-7000-8000-0000000d0005',
} as const

export const DEMO_TIMEZONE = 'Europe/Belgrade'

export const demoOrganizer = {
  id: DEMO_ORGANIZER_ID,
  slug: DEMO_ORGANIZER_SLUG,
  name: 'Studio Lumen',
  messenger: 'telegram' as const,
  /**
   * Sentinel messenger id — deliberately not a real Telegram account, so the
   * demo can never be logged into via the widget and the worker has nobody to
   * notify. Must stay unique against `organizers_messenger_id_key`.
   */
  messengerId: 'demo-account',
  timezone: DEMO_TIMEZONE,
  description: `**Boutique movement studio** in the heart of Belgrade.

Small-group **yoga**, **breathwork**, and **pottery** — come as you are, _beginners always welcome_.

What we offer:

- 🧘 Morning Vinyasa flow
- 🌬️ Evening breathwork circles
- 🏺 Hand-building pottery workshops

_This is a read-only demo page — [create your own](https://countmein.group/signup) in minutes._`,
  photoUrl: '/organizer-avatar.png',
  location: 'Kralja Petra 12, Belgrade',
  contact: 'studio@studiolumen.rs',
}

export const demoServices = [
  {
    id: DEMO_SERVICE_IDS.yoga,
    organizerId: DEMO_ORGANIZER_ID,
    title: 'Morning Vinyasa Flow',
    description:
      'A dynamic 60-minute flow to wake up the body and mind. Suitable for all levels. Mats and props provided.',
    photoUrl: '/service-yoga.png',
    location: null,
    contact: null,
    defaultPrice: '1200 RSD',
    defaultCapacity: 12,
    defaultDurationMinutes: 60,
    options: ['Downtown studio', 'Riverside studio'],
    optionsSelectMode: 'single' as const,
  },
  {
    id: DEMO_SERVICE_IDS.pottery,
    organizerId: DEMO_ORGANIZER_ID,
    title: 'Hand-Building Pottery Workshop',
    description:
      'Shape your own mug or bowl from scratch. All clay, tools, and firing included. Great for a creative afternoon with friends.',
    photoUrl: '/service-pottery.png',
    location: 'Ceramics Loft, Cetinjska 15, Belgrade',
    contact: '+381 64 999 1234',
    defaultPrice: 'from 2500 RSD',
    defaultCapacity: 8,
    defaultDurationMinutes: 120,
    options: ['Bring a friend (+1 seat)', 'Take-home glaze kit', 'Photo of your piece'],
    optionsSelectMode: 'multi' as const,
  },
  {
    id: DEMO_SERVICE_IDS.breathwork,
    organizerId: DEMO_ORGANIZER_ID,
    title: 'Evening Breathwork Circle',
    description:
      'A calming 45-minute guided breathwork session to close out your day. Dim lights, warm blankets, deep rest.',
    photoUrl: '/service-breathwork.png',
    location: null,
    contact: null,
    defaultPrice: '900 RSD',
    defaultCapacity: 16,
    defaultDurationMinutes: 45,
    options: null,
    optionsSelectMode: null,
  },
]

/**
 * Slot templates: `dayOffset` / `hour` are resolved against the day *after* the
 * seed run, so a refresh always produces a week of strictly upcoming slots.
 *
 * Anchoring on "tomorrow" rather than "today" matters: a `dayOffset: 0` slot at
 * 07:00 would already be in the past whenever the seed runs later in the day,
 * and a demo page whose first slot is expired is exactly the failure this seed
 * exists to fix.
 */
const demoSlotTemplates = [
  // Yoga — a mix of open, filling and full so the UI shows every seat state.
  {
    id: DEMO_SLOT_IDS.y1,
    serviceId: DEMO_SERVICE_IDS.yoga,
    dayOffset: 0,
    hour: 7,
    durationMinutes: 60,
    capacity: 12,
    bookedCount: 9,
    price: null,
  },
  {
    id: DEMO_SLOT_IDS.y2,
    serviceId: DEMO_SERVICE_IDS.yoga,
    dayOffset: 1,
    hour: 7,
    durationMinutes: 60,
    capacity: 12,
    bookedCount: 12,
    price: null,
  },
  {
    id: DEMO_SLOT_IDS.y3,
    serviceId: DEMO_SERVICE_IDS.yoga,
    dayOffset: 2,
    hour: 7,
    durationMinutes: 60,
    capacity: 12,
    bookedCount: 4,
    price: null,
  },
  {
    id: DEMO_SLOT_IDS.y4,
    serviceId: DEMO_SERVICE_IDS.yoga,
    dayOffset: 3,
    hour: 7,
    durationMinutes: 60,
    capacity: 12,
    bookedCount: 1,
    price: '1400 RSD',
  },
  // Pottery
  {
    id: DEMO_SLOT_IDS.p1,
    serviceId: DEMO_SERVICE_IDS.pottery,
    dayOffset: 1,
    hour: 15,
    durationMinutes: 120,
    capacity: 8,
    bookedCount: 5,
    price: null,
  },
  {
    id: DEMO_SLOT_IDS.p2,
    serviceId: DEMO_SERVICE_IDS.pottery,
    dayOffset: 4,
    hour: 15,
    durationMinutes: 120,
    capacity: 8,
    bookedCount: 8,
    price: null,
  },
  {
    id: DEMO_SLOT_IDS.p3,
    serviceId: DEMO_SERVICE_IDS.pottery,
    dayOffset: 6,
    hour: 11,
    durationMinutes: 120,
    capacity: 8,
    bookedCount: 2,
    price: null,
  },
  // Breathwork
  {
    id: DEMO_SLOT_IDS.b1,
    serviceId: DEMO_SERVICE_IDS.breathwork,
    dayOffset: 0,
    hour: 18,
    durationMinutes: 45,
    capacity: 16,
    bookedCount: 11,
    price: null,
  },
  {
    id: DEMO_SLOT_IDS.b2,
    serviceId: DEMO_SERVICE_IDS.breathwork,
    dayOffset: 2,
    hour: 18,
    durationMinutes: 45,
    capacity: 16,
    bookedCount: 16,
    price: null,
  },
  {
    id: DEMO_SLOT_IDS.b3,
    serviceId: DEMO_SERVICE_IDS.breathwork,
    dayOffset: 5,
    hour: 18,
    durationMinutes: 45,
    capacity: 16,
    bookedCount: 6,
    price: null,
  },
]

/**
 * Resolve slot templates against `now`.
 * `bookedCount` is seeded as a plain number rather than derived from the
 * `bookings` rows below: the demo intentionally shows realistic fill levels
 * without needing a booking row per seat. Because the account is read-only,
 * these counters never drift.
 */
export function buildDemoSlots(now: Date = new Date()) {
  return demoSlotTemplates.map((template) => {
    const startsAt = new Date(now)
    startsAt.setUTCDate(startsAt.getUTCDate() + template.dayOffset + 1)
    startsAt.setUTCHours(template.hour, 0, 0, 0)

    return {
      id: template.id,
      serviceId: template.serviceId,
      startsAt,
      durationMinutes: template.durationMinutes,
      capacity: template.capacity,
      bookedCount: template.bookedCount,
      price: template.price,
    }
  })
}

/**
 * A few illustrative bookings for the cabinet's bookings table.
 * `manageToken`s are deterministic and publicly known — acceptable only because
 * every write path rejects the demo account (ADR-010), so a leaked demo token
 * cannot cancel anything.
 */
export function buildDemoBookings(now: Date = new Date()) {
  const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000)

  return [
    {
      id: DEMO_BOOKING_IDS.b1,
      timeSlotId: DEMO_SLOT_IDS.y1,
      status: 'confirmed' as const,
      seats: 2,
      guestName: 'Mila Petrović',
      guestMessenger: 'telegram' as const,
      guestMessengerId: 'demo-guest-1',
      guestMessengerLogin: '@milapetrovic',
      manageToken: 'demo-manage-token-1',
      selectedOptions: ['Downtown studio'],
      createdAt: daysAgo(2),
    },
    {
      id: DEMO_BOOKING_IDS.b2,
      timeSlotId: DEMO_SLOT_IDS.p1,
      status: 'confirmed' as const,
      seats: 1,
      guestName: 'Noah Ellis',
      guestMessenger: 'telegram' as const,
      guestMessengerId: 'demo-guest-2',
      guestMessengerLogin: null,
      manageToken: 'demo-manage-token-2',
      selectedOptions: ['Take-home glaze kit', 'Photo of your piece'],
      createdAt: daysAgo(3),
    },
    {
      id: DEMO_BOOKING_IDS.b3,
      timeSlotId: DEMO_SLOT_IDS.b1,
      status: 'confirmed' as const,
      seats: 1,
      guestName: 'Ana Kovač',
      guestMessenger: 'telegram' as const,
      guestMessengerId: 'demo-guest-3',
      guestMessengerLogin: '@ana_kovac',
      manageToken: 'demo-manage-token-3',
      selectedOptions: null,
      createdAt: daysAgo(1),
    },
    {
      id: DEMO_BOOKING_IDS.b4,
      timeSlotId: DEMO_SLOT_IDS.y3,
      status: 'confirmed' as const,
      seats: 3,
      guestName: 'Luka Jovanović',
      guestMessenger: 'telegram' as const,
      guestMessengerId: 'demo-guest-4',
      guestMessengerLogin: '@lukajovanovic',
      manageToken: 'demo-manage-token-4',
      selectedOptions: ['Riverside studio'],
      createdAt: daysAgo(1),
    },
    {
      id: DEMO_BOOKING_IDS.b5,
      timeSlotId: DEMO_SLOT_IDS.p1,
      status: 'cancelled' as const,
      seats: 1,
      guestName: 'Sara Nikolić',
      guestMessenger: 'telegram' as const,
      guestMessengerId: 'demo-guest-5',
      guestMessengerLogin: '@sara_nikolic',
      manageToken: 'demo-manage-token-5',
      selectedOptions: null,
      createdAt: daysAgo(4),
    },
  ]
}
