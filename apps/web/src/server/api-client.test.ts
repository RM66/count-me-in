import type {
  BookingRecord,
  GuestBooking,
  OrganizerProfile,
  PublicOrganizer,
  ServiceRecord,
  TimeSlotRecord,
} from '@repo/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Unit tests for the server-side read layer (`api-client.ts`).
 *
 * The wire is mocked at two boundaries: `apiFetch` (the session-minting
 * helper in `api.ts`, already covered by `api.test.ts`) and the global
 * `fetch` for public/guest reads. What matters here is the contract the
 * pages rely on: envelope unwrapping, 404→null, schema validation, and
 * the caching rules (no-store for scoped data, tags for public).
 */

const apiFetchMock = vi.fn()
const fetchMock = vi.fn()

vi.mock('@/server/api', () => ({
  apiFetch: apiFetchMock,
}))

vi.mock('@/server/api-origin', () => ({
  resolveApiOrigin: vi.fn(async () => 'http://api.test'),
  deploymentBypassHeaders: vi.fn(() => ({})),
}))

vi.mock('@/server/internal-api', () => ({
  internalSecretHeaders: vi.fn(() => ({ 'x-internal-secret': 'test-secret' })),
  withInternalHeaders: vi.fn((headers: Headers) => headers.set('x-internal-secret', 'test-secret')),
}))

const organizerId = '11111111-1111-4111-8111-111111111111'

const publicOrganizer: PublicOrganizer = {
  id: organizerId,
  slug: 'yoga-anna',
  name: 'Anna',
  timezone: 'Europe/Belgrade',
  description: null,
  photoUrl: null,
  location: null,
  contact: null,
  isDemo: false,
}

const organizerProfile: OrganizerProfile = {
  ...publicOrganizer,
  messenger: 'telegram',
  messengerId: '42',
  language: 'en',
  createdAt: '2026-01-01T00:00:00.000Z',
}

const serviceRecord: ServiceRecord = {
  id: 'svc_abcdef',
  organizerId,
  title: 'Morning yoga',
  description: null,
  photoUrl: null,
  location: null,
  contact: null,
  defaultPrice: '10 EUR',
  defaultCapacity: 10,
  defaultDurationMinutes: 60,
  maxSeatsPerBooking: 4,
  options: null,
  optionsSelectMode: null,
  createdAt: '2026-01-01T00:00:00.000Z',
}

const timeSlotRecord: TimeSlotRecord = {
  id: '22222222-2222-4222-8222-222222222222',
  serviceId: serviceRecord.id,
  startsAt: '2026-06-01T10:00:00.000Z',
  durationMinutes: 60,
  capacity: 10,
  bookedCount: 2,
  hasBookings: null,
  price: null,
  createdAt: '2026-01-01T00:00:00.000Z',
}

const bookingRecord: BookingRecord = {
  id: '33333333-3333-4333-8333-333333333333',
  timeSlotId: timeSlotRecord.id,
  status: 'confirmed',
  seats: 2,
  guestName: 'Guest',
  guestMessenger: 'telegram',
  guestMessengerId: '42',
  guestMessengerLogin: null,
  selectedOptions: null,
  createdAt: '2026-01-01T00:00:00.000Z',
}

const guestBooking: GuestBooking = {
  id: bookingRecord.id,
  status: 'confirmed',
  seats: 2,
  guestName: 'Guest',
  selectedOptions: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  manageToken: 'manage-token-0123456789',
  canCancel: true,
  slot: timeSlotRecord,
  service: serviceRecord,
  organizer: publicOrganizer,
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

describe('public reads', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    apiFetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('unwraps the public organizer view envelope', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        organizer: publicOrganizer,
        services: [serviceRecord],
        slots: [timeSlotRecord],
      }),
    )
    const { getPublicOrganizerView } = await import('@/server/api-client')
    const view = await getPublicOrganizerView('Yoga-Anna')
    expect(view?.organizer.slug).toBe('yoga-anna')
    expect(view?.services).toHaveLength(1)
    expect(view?.slots).toHaveLength(1)
  })

  it('lowercases and encodes the slug in the request path', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ organizer: publicOrganizer, services: [], slots: [] }),
    )
    const { getPublicOrganizerView } = await import('@/server/api-client')
    await getPublicOrganizerView('Yoga-Anna')
    const [url] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('http://api.test/api/public/organizers/yoga-anna')
  })

  it('caches public reads with tags and carries the internal secret', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ organizer: publicOrganizer, services: [], slots: [] }),
    )
    const { getPublicOrganizerView } = await import('@/server/api-client')
    await getPublicOrganizerView('yoga-anna')
    const init = fetchMock.mock.calls[0]![1] as RequestInit & {
      next: { tags: string[]; revalidate: number }
    }
    expect(init.next.tags).toContain('public-organizer:yoga-anna')
    expect((init.headers as Headers).get('x-internal-secret')).toBe('test-secret')
  })

  it('returns null on 404', async () => {
    fetchMock.mockResolvedValue(new Response('not found', { status: 404 }))
    const { getPublicOrganizerView, getPublicServiceView } = await import('@/server/api-client')
    expect(await getPublicOrganizerView('missing')).toBeNull()
    expect(await getPublicServiceView('svc_missing')).toBeNull()
  })

  it('throws on non-404 failures', async () => {
    fetchMock.mockResolvedValue(new Response('oops', { status: 500 }))
    const { getPublicOrganizerView } = await import('@/server/api-client')
    await expect(getPublicOrganizerView('yoga-anna')).rejects.toThrow('answered 500')
  })

  it('throws a contract violation on an unexpected shape', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ totally: 'wrong' }))
    const { getPublicOrganizerView } = await import('@/server/api-client')
    await expect(getPublicOrganizerView('yoga-anna')).rejects.toThrow('contract violation')
  })

  it('returns the service view envelope', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ service: serviceRecord, organizer: publicOrganizer, slots: [] }),
    )
    const { getPublicServiceView } = await import('@/server/api-client')
    const view = await getPublicServiceView(serviceRecord.id)
    expect(view?.service.id).toBe(serviceRecord.id)
    const [url] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe(`http://api.test/api/public/services/${serviceRecord.id}`)
  })

  it('returns the sitemap and throws when it 404s', async () => {
    const { getPublicSitemap } = await import('@/server/api-client')
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        organizers: [{ slug: 'yoga-anna' }],
        services: [{ orgSlug: 'yoga-anna', serviceId: serviceRecord.id }],
      }),
    )
    const sitemap = await getPublicSitemap()
    expect(sitemap.organizers).toHaveLength(1)
    fetchMock.mockResolvedValueOnce(new Response('not found', { status: 404 }))
    await expect(getPublicSitemap()).rejects.toThrow('answered 404')
  })
})

describe('getGuestBooking', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    apiFetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('POSTs the token in the body and returns the booking', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ booking: guestBooking }))
    const { getGuestBooking } = await import('@/server/api-client')
    const booking = await getGuestBooking('manage-token-0123456789')
    expect(booking?.id).toBe(guestBooking.id)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('http://api.test/api/bookings/manage-lookup')
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      manageToken: 'manage-token-0123456789',
    })
    expect((init as RequestInit).cache).toBe('no-store')
    expect((init as RequestInit).headers).toBeInstanceOf(Headers)
    expect(((init as RequestInit).headers as Headers).get('x-internal-secret')).toBe('test-secret')
  })

  it('maps a 400 lookup refusal to null', async () => {
    fetchMock.mockResolvedValue(new Response('expired', { status: 400 }))
    const { getGuestBooking } = await import('@/server/api-client')
    expect(await getGuestBooking('expired-token')).toBeNull()
  })

  it('maps a 404 to null', async () => {
    fetchMock.mockResolvedValue(new Response('not found', { status: 404 }))
    const { getGuestBooking } = await import('@/server/api-client')
    expect(await getGuestBooking('unknown-token')).toBeNull()
  })
})

describe('cabinet reads', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
    fetchMock.mockReset()
    apiFetchMock.mockResolvedValue(jsonResponse({}))
  })

  it('goes through apiFetch (which forces no-store, never the shared cache)', async () => {
    apiFetchMock.mockResolvedValue(jsonResponse({ organizer: organizerProfile }))
    const { getOrganizerProfile } = await import('@/server/api-client')
    await getOrganizerProfile()
    const [path] = apiFetchMock.mock.calls[0]!
    expect(path).toBe('/api/organizers/me')
  })

  it('unwraps the organizer profile envelope', async () => {
    apiFetchMock.mockResolvedValue(jsonResponse({ organizer: organizerProfile }))
    const { getOrganizerProfile } = await import('@/server/api-client')
    const profile = await getOrganizerProfile()
    expect(profile?.slug).toBe('yoga-anna')
    expect(profile?.language).toBe('en')
  })

  it('returns null when the API has no profile for the viewer', async () => {
    apiFetchMock.mockResolvedValue(new Response('not found', { status: 404 }))
    const { getOrganizerProfile } = await import('@/server/api-client')
    expect(await getOrganizerProfile()).toBeNull()
  })

  it('lists services, defaulting to an empty array', async () => {
    const { listServices } = await import('@/server/api-client')
    apiFetchMock.mockResolvedValueOnce(jsonResponse({ services: [serviceRecord] }))
    expect(await listServices()).toHaveLength(1)
    apiFetchMock.mockResolvedValueOnce(new Response('not found', { status: 404 }))
    expect(await listServices()).toEqual([])
  })

  it('returns an owned service and null for a foreign one', async () => {
    const { getOwnedService } = await import('@/server/api-client')
    apiFetchMock.mockResolvedValueOnce(jsonResponse({ service: serviceRecord }))
    expect((await getOwnedService(serviceRecord.id))?.id).toBe(serviceRecord.id)
    apiFetchMock.mockResolvedValueOnce(new Response('not found', { status: 404 }))
    expect(await getOwnedService('svc_foreign')).toBeNull()
  })

  it('adds the upcoming and range filters to the slots query', async () => {
    // mockImplementation, not mockResolvedValue: a Response body is
    // consumed on read, so a reused instance fails the second call.
    apiFetchMock.mockImplementation(async () =>
      jsonResponse({ slots: [timeSlotRecord], days: ['2026-07-20'] }),
    )
    const { listSlots } = await import('@/server/api-client')
    const page = await listSlots()
    expect(page.slots).toHaveLength(1)
    expect(page.days).toEqual(['2026-07-20'])
    expect(apiFetchMock.mock.calls[0]![0]).toBe('/api/slots')
    await listSlots({
      upcomingOnly: true,
      from: '2026-07-20T00:00:00+00:00',
      to: '2026-07-27T00:00:00+00:00',
      limit: 5,
    })
    expect(apiFetchMock.mock.calls[1]![0]).toBe(
      '/api/slots?upcoming=1&from=2026-07-20T00%3A00%3A00%2B00%3A00&to=2026-07-27T00%3A00%3A00%2B00%3A00&limit=5',
    )
  })

  it('paginates bookings and reports hasMore', async () => {
    apiFetchMock.mockResolvedValue(
      jsonResponse({
        bookings: [bookingRecord],
        hasMore: true,
        slots: [timeSlotRecord],
        bookedDays: ['2026-07-20'],
      }),
    )
    const { listBookings } = await import('@/server/api-client')
    const page = await listBookings({ limit: 10, offset: 20 })
    expect(page.bookings).toHaveLength(1)
    expect(page.hasMore).toBe(true)
    expect(page.slots).toHaveLength(1)
    expect(page.bookedDays).toEqual(['2026-07-20'])
    expect(apiFetchMock.mock.calls[0]![0]).toBe('/api/bookings?limit=10&offset=20')
  })

  it('forwards the cabinet filters to the bookings query', async () => {
    apiFetchMock.mockResolvedValue(
      jsonResponse({ bookings: [], hasMore: false, slots: [], bookedDays: [] }),
    )
    const { listBookings } = await import('@/server/api-client')
    await listBookings({
      serviceId: 'svc-1',
      slotId: 'slot-9',
      status: 'confirmed',
      q: 'ann',
      day: '2026-07-22',
      sort: 'when',
      dir: 'desc',
    })
    expect(apiFetchMock.mock.calls[0]![0]).toBe(
      '/api/bookings?limit=50&offset=0&serviceId=svc-1&slotId=slot-9&status=confirmed&q=ann&day=2026-07-22&sort=when&dir=desc',
    )
  })

  it('uses the default page size when none is given', async () => {
    apiFetchMock.mockResolvedValue(
      jsonResponse({ bookings: [], hasMore: false, slots: [], bookedDays: [] }),
    )
    const { listBookings } = await import('@/server/api-client')
    const page = await listBookings()
    expect(page).toEqual({ bookings: [], hasMore: false, slots: [], bookedDays: [] })
    expect(apiFetchMock.mock.calls[0]![0]).toBe('/api/bookings?limit=50&offset=0')
  })

  it('returns the cabinet summary and throws when it 404s', async () => {
    const summary = {
      overview: {
        confirmedBookings: 12,
        confirmedLast7Days: 3,
        upcomingSlots: 4,
        upcomingSlotsNext7Days: 2,
        upcomingSeatsBooked: 9,
        upcomingSeatsOffered: 40,
      },
      serviceCounts: [
        { serviceId: serviceRecord.id, upcomingSlotsCount: 3, confirmedBookingsCount: 7 },
      ],
      analytics: {
        totalBookings: 7,
        prevTotalBookings: 5,
        seatsSold: 12,
        prevSeatsSold: 9,
        windowBookings: 7,
        cancelledInWindow: 1,
        trend: [{ day: '2026-06-01', bookings: 2, seats: 4 }],
        byService: [{ service: 'Morning yoga', bookings: 7 }],
      },
    }
    const { getCabinetSummary } = await import('@/server/api-client')
    apiFetchMock.mockResolvedValueOnce(jsonResponse(summary))
    expect((await getCabinetSummary()).analytics.totalBookings).toBe(7)
    apiFetchMock.mockResolvedValueOnce(new Response('not found', { status: 404 }))
    await expect(getCabinetSummary()).rejects.toThrow('answered 404')
  })
})
