import { DEMO_ORGANIZER_ID, DEMO_ORGANIZER_SLUG, DEMO_SERVICE_IDS } from '@repo/contracts'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Integration tests for the server/db read layer.
 *
 * These reads serve the cabinet, the public pages and the sitemap; the write
 * side lives in the Go API and is covered there. The fixture is the demo seed
 * (ADR-010): deterministic ids, 3 services, 19 slots, 40 bookings — seeded
 * fresh in `beforeAll` so the assertions are stable regardless of prior
 * local state.
 *
 * Gating follows the Go `requirePostgres` convention: skip locally without
 * POSTGRES_URL, fail in CI where the service is guaranteed.
 */

const hasPostgres = Boolean(process.env.POSTGRES_URL)
const maybeDescribe = !hasPostgres && process.env.CI !== 'true' ? describe.skip : describe

// `@repo/db`'s client throws at import time without POSTGRES_URL — lazy.
type DbModule = typeof import('@repo/db')
let dbModule: DbModule | undefined

maybeDescribe('server/db reads (integration, real Postgres)', () => {
  beforeAll(async () => {
    if (!hasPostgres) {
      throw new Error('POSTGRES_URL is not set — server/db read tests need a real Postgres.')
    }
    dbModule = await import('@repo/db')
    await dbModule.seedDemo()
  }, 60_000)

  describe('organizer reads', () => {
    it('getPublicOrganizerBySlug resolves the demo slug and hides messenger identity', async () => {
      const { getPublicOrganizerBySlug } = await import('@/server/db/organizer')
      const org = await getPublicOrganizerBySlug(DEMO_ORGANIZER_SLUG)
      expect(org).not.toBeNull()
      expect(org!.id).toBe(DEMO_ORGANIZER_ID)
      expect(org!.isDemo).toBe(true)
      // The public DTO must not carry the organizer's messenger identity.
      expect(org!).not.toHaveProperty('messengerId')
      expect(org!).not.toHaveProperty('messenger')
    })

    it('getPublicOrganizerBySlug lowercases the slug before lookup', async () => {
      const { getPublicOrganizerBySlug } = await import('@/server/db/organizer')
      const org = await getPublicOrganizerBySlug(DEMO_ORGANIZER_SLUG.toUpperCase())
      expect(org?.id).toBe(DEMO_ORGANIZER_ID)
    })

    it('getPublicOrganizerBySlug returns null for an unknown slug', async () => {
      const { getPublicOrganizerBySlug } = await import('@/server/db/organizer')
      expect(await getPublicOrganizerBySlug('no-such-organizer')).toBeNull()
    })

    it('getOrganizerProfile returns the full profile with isDemo flag', async () => {
      const { getOrganizerProfile } = await import('@/server/db/organizer')
      const profile = await getOrganizerProfile(DEMO_ORGANIZER_ID, true)
      expect(profile).not.toBeNull()
      expect(profile!.slug).toBe(DEMO_ORGANIZER_SLUG)
      expect(profile!.messengerId).toBe('demo-account')
      expect(profile!.isDemo).toBe(true)
      expect(profile!.language).toBe('en')
    })

    it('getOrganizerProfile returns null for an unknown id', async () => {
      const { getOrganizerProfile } = await import('@/server/db/organizer')
      expect(await getOrganizerProfile('01930000-0000-7000-8000-00000000dead', false)).toBeNull()
    })

    it('listPublicOrganizerSlugs includes the demo slug', async () => {
      const { listPublicOrganizerSlugs } = await import('@/server/db/organizer')
      const slugs = await listPublicOrganizerSlugs()
      expect(slugs.some((s) => s.slug === DEMO_ORGANIZER_SLUG)).toBe(true)
    })
  })

  describe('service reads', () => {
    it('listServices returns the 3 demo services with DTO shape', async () => {
      const { listServices } = await import('@/server/db/service')
      const services = await listServices(DEMO_ORGANIZER_ID)
      expect(services).toHaveLength(3)
      const ids = services.map((s) => s.id).sort()
      expect(ids).toEqual(Object.values(DEMO_SERVICE_IDS).sort())
      // DTO shape: dates are ISO strings, not Date objects.
      for (const service of services) {
        expect(typeof service.createdAt).toBe('string')
        expect(service.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      }
    })

    it('getOwnedService scopes by organizer — another organizer gets null', async () => {
      const { getOwnedService } = await import('@/server/db/service')
      const mine = await getOwnedService(DEMO_ORGANIZER_ID, DEMO_SERVICE_IDS.yoga)
      expect(mine?.id).toBe(DEMO_SERVICE_IDS.yoga)
      // A different organizer id must not see the demo's service.
      expect(
        await getOwnedService('01930000-0000-7000-8000-00000000dead', DEMO_SERVICE_IDS.yoga),
      ).toBeNull()
      expect(await getOwnedService(DEMO_ORGANIZER_ID, 'no-such-service')).toBeNull()
    })

    it('countUpcomingSlots counts only future slots per service', async () => {
      const { countUpcomingSlots } = await import('@/server/db/service')
      const counts = await countUpcomingSlots(Object.values(DEMO_SERVICE_IDS))
      // The seed guarantees upcoming slots for every service (dayOffset >= 0
      // resolves to tomorrow): yoga 4, pottery 3, breathwork 3.
      expect(counts[DEMO_SERVICE_IDS.yoga]).toBe(4)
      expect(counts[DEMO_SERVICE_IDS.pottery]).toBe(3)
      expect(counts[DEMO_SERVICE_IDS.breathwork]).toBe(3)
      expect(await countUpcomingSlots([])).toEqual({})
    })

    it('listPublicServicePaths pairs every service with its owner slug', async () => {
      const { listPublicServicePaths } = await import('@/server/db/service')
      const paths = await listPublicServicePaths()
      const demoPaths = paths.filter((p) => p.orgSlug === DEMO_ORGANIZER_SLUG)
      expect(demoPaths.map((p) => p.serviceId).sort()).toEqual(
        Object.values(DEMO_SERVICE_IDS).sort(),
      )
    })
  })

  describe('time-slot reads', () => {
    it('listSlots returns all 19 slots, earliest first', async () => {
      const { listSlots } = await import('@/server/db/time-slot')
      const slots = await listSlots(DEMO_ORGANIZER_ID)
      expect(slots).toHaveLength(19)
      for (let i = 1; i < slots.length; i++) {
        expect(slots[i]!.startsAt >= slots[i - 1]!.startsAt).toBe(true)
      }
    })

    it('listSlots upcomingOnly drops the past slots', async () => {
      const { listSlots } = await import('@/server/db/time-slot')
      const all = await listSlots(DEMO_ORGANIZER_ID)
      const upcoming = await listSlots(DEMO_ORGANIZER_ID, { upcomingOnly: true })
      expect(upcoming.length).toBe(10)
      expect(upcoming.length).toBeLessThan(all.length)
      for (const slot of upcoming) {
        expect(new Date(slot.startsAt).getTime()).toBeGreaterThan(Date.now())
      }
    })

    it('listUpcomingSlotsForServices scopes by service ids and drops the past', async () => {
      const { listUpcomingSlotsForServices } = await import('@/server/db/time-slot')
      const yoga = await listUpcomingSlotsForServices([DEMO_SERVICE_IDS.yoga])
      expect(yoga).toHaveLength(4)
      expect(await listUpcomingSlotsForServices([])).toEqual([])
    })
  })

  describe('booking reads', () => {
    it('listBookings returns all 40 demo bookings, newest first, without manageToken', async () => {
      const { listBookings } = await import('@/server/db/booking')
      const bookings = await listBookings(DEMO_ORGANIZER_ID, { limit: 100 })
      expect(bookings).toHaveLength(40)
      for (let i = 1; i < bookings.length; i++) {
        expect(bookings[i]!.createdAt <= bookings[i - 1]!.createdAt).toBe(true)
      }
      // The organizer's DTO must never carry the guest's cancellation secret.
      for (const booking of bookings) {
        expect(booking).not.toHaveProperty('manageToken')
      }
    })

    it('listBookings paginates with limit/offset', async () => {
      const { listBookings } = await import('@/server/db/booking')
      const page1 = await listBookings(DEMO_ORGANIZER_ID, { limit: 15 })
      const page2 = await listBookings(DEMO_ORGANIZER_ID, { limit: 15, offset: 15 })
      expect(page1).toHaveLength(15)
      expect(page2).toHaveLength(15)
      const ids = new Set([...page1, ...page2].map((b) => b.id))
      expect(ids.size).toBe(30)
    })

    it('countConfirmedBookings excludes cancelled bookings', async () => {
      const { countConfirmedBookings } = await import('@/server/db/booking')
      const counts = await countConfirmedBookings(Object.values(DEMO_SERVICE_IDS))
      const total = Object.values(counts).reduce((a, b) => a + b, 0)
      // 40 seeded bookings, 4 of them cancelled (b5, b14, b22, b35) → 36 confirmed.
      expect(total).toBe(36)
      expect(await countConfirmedBookings([])).toEqual({})
    })

    it('getGuestBookingByToken resolves the full chain through the token hash', async () => {
      const { getGuestBookingByToken } = await import('@/server/db/booking')
      const { eq } = await import('drizzle-orm')
      // Manage tokens are minted randomly per seed run (ADR-020), so read
      // the live token instead of relying on a committed literal. The
      // token belongs to demo-guest-1's first booking, whose slot is one
      // of the upcoming ones — its expiry (slot start + 24h) is in the
      // future, which the read enforces.
      const [row] = await dbModule!.db
        .select({ manageToken: dbModule!.bookings.manageToken })
        .from(dbModule!.bookings)
        .where(eq(dbModule!.bookings.guestMessengerId, 'demo-guest-1'))
        .limit(1)
      expect(row?.manageToken).toBeTruthy()

      const guest = await getGuestBookingByToken(row!.manageToken)
      expect(guest).not.toBeNull()
      expect(guest!.manageToken).toBe(row!.manageToken)
      expect(guest!.guestName).toBe('Mila Petrović')
      expect(guest!.canCancel).toBe(true)
      // The full parent chain comes along for the guest page.
      expect(guest!.slot.id).toMatch(/^01930000-/)
      expect(guest!.organizer.slug).toBe(DEMO_ORGANIZER_SLUG)
      // The guest DTO keeps the token (it is the guest's own link); the
      // organizer DTO above must not.
      expect(guest!.service.id).toBeTruthy()
      expect(await getGuestBookingByToken('unknown-token')).toBeNull()
    })

    it('an expired manage token answers like an unknown one', async () => {
      const { getGuestBookingByToken } = await import('@/server/db/booking')
      const { eq } = await import('drizzle-orm')
      // demo-guest-9's booking sits on a past slot: the token was born
      // expired (slot start + 24h), so the manage page must 404 exactly
      // like an unknown token — parity with the Go cancel write.
      const [row] = await dbModule!.db
        .select({ manageToken: dbModule!.bookings.manageToken })
        .from(dbModule!.bookings)
        .where(eq(dbModule!.bookings.guestMessengerId, 'demo-guest-9'))
        .limit(1)
      expect(row?.manageToken).toBeTruthy()
      expect(await getGuestBookingByToken(row!.manageToken)).toBeNull()
    })

    it('getAnalyticsSummary aggregates the seeded windows', async () => {
      const { getAnalyticsSummary } = await import('@/server/db/booking')
      const summary = await getAnalyticsSummary(DEMO_ORGANIZER_ID)
      // Seed spreads bookings over the last ~60 days: 25 in the last 30
      // (3 cancelled: b5, b14, b22), 14 in the previous window (1 cancelled:
      // b35) — b40 at daysAgo(60) sits exactly on the boundary and falls
      // outside because the query runs seconds after the seed.
      expect(summary.totalBookings).toBe(22)
      expect(summary.prevTotalBookings).toBe(13)
      expect(summary.windowBookings).toBe(25)
      expect(summary.cancelledInWindow).toBe(3)
      expect(summary.trend).toHaveLength(7)
      expect(summary.byService.length).toBeGreaterThan(0)
      // An unknown organizer aggregates to zeros, not an error.
      const empty = await getAnalyticsSummary('01930000-0000-7000-8000-00000000dead')
      expect(empty.totalBookings).toBe(0)
      expect(empty.trend).toHaveLength(7)
      expect(empty.trend.every((d) => d.bookings === 0)).toBe(true)
    })
  })
})
