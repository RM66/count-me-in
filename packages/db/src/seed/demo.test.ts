import { DEMO_ORGANIZER_ID, DEMO_ORGANIZER_SLUG } from '@repo/contracts'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Snapshot test for the demo seed (ADR-010).
 *
 * `seedDemo` writes through the shared `db` client (a max:1 connection pool),
 * so wrapping it in an outer transaction would deadlock on the single held
 * connection — the test seeds for real instead and restores prior state in
 * `afterAll` (re-seeding is the production refresh path anyway, so a leftover
 * demo is not corruption).
 *
 * Postgres gating follows the Go `requirePostgres` convention: skip locally
 * when POSTGRES_URL is unset, fail in CI where the service is guaranteed.
 */

const hasPostgres = Boolean(process.env.POSTGRES_URL)
const maybeDescribe = !hasPostgres && process.env.CI !== 'true' ? describe.skip : describe

// `client.ts` throws at import time without POSTGRES_URL — import lazily.
type DbModule = typeof import('../index')
let dbModule: DbModule | undefined

function requireDb(): DbModule {
  if (!dbModule) throw new Error('db module not loaded — beforeAll failed?')
  return dbModule
}

let demoExistedBefore = false

async function demoCounts() {
  const { db, organizers, services, timeSlots, bookings } = requireDb()
  const orgRows = await db
    .select({ id: organizers.id })
    .from(organizers)
    .where(eq(organizers.id, DEMO_ORGANIZER_ID))
  const svcRows = await db
    .select({ id: services.id })
    .from(services)
    .where(eq(services.organizerId, DEMO_ORGANIZER_ID))
  const serviceIds = svcRows.map((s) => s.id)
  const slotRows = serviceIds.length
    ? await db
        .select({ id: timeSlots.id })
        .from(timeSlots)
        .where(inArray(timeSlots.serviceId, serviceIds))
    : []
  const bookingRows = slotRows.length
    ? await db
        .select({ id: bookings.id })
        .from(bookings)
        .where(
          inArray(
            bookings.timeSlotId,
            slotRows.map((s) => s.id),
          ),
        )
    : []
  return {
    organizers: orgRows.length,
    services: svcRows.length,
    slots: slotRows.length,
    bookings: bookingRows.length,
  }
}

maybeDescribe('seedDemo (integration, real Postgres)', () => {
  beforeAll(async () => {
    if (!hasPostgres) {
      throw new Error(
        'POSTGRES_URL is not set — the demo seed snapshot test needs a real Postgres. ' +
          'This failure means CI lost its postgres service.',
      )
    }
    dbModule = await import('../index')
    const { db, organizers } = dbModule
    const existing = await db
      .select({ id: organizers.id })
      .from(organizers)
      .where(eq(organizers.id, DEMO_ORGANIZER_ID))
    demoExistedBefore = existing.length > 0
  }, 60_000)

  afterAll(async () => {
    if (!dbModule) return
    // Restore local state: the demo is expected to exist in dev/production.
    if (demoExistedBefore) {
      await dbModule.seedDemo()
    } else {
      await dbModule.removeDemo()
    }
  }, 60_000)

  it('seeds the demo organizer with the contract id', async () => {
    await requireDb().seedDemo()
    const { db, organizers } = requireDb()
    const rows = await db.select().from(organizers).where(eq(organizers.id, DEMO_ORGANIZER_ID))
    expect(rows).toHaveLength(1)
    const org = rows[0]!
    expect(org.slug).toBe(DEMO_ORGANIZER_SLUG)
    expect(org.timezone).toBe('Europe/Belgrade')
    expect(org.location).toBeTruthy()
    expect(org.contact).toBeTruthy()
  })

  it('seeds exactly 3 services, 19 slots and 40 bookings', async () => {
    await requireDb().seedDemo()
    expect(await demoCounts()).toEqual({ organizers: 1, services: 3, slots: 19, bookings: 40 })
  })

  it('seeds services with non-empty prices and valid options pairs', async () => {
    const { db, services } = requireDb()
    const rows = await db.select().from(services).where(eq(services.organizerId, DEMO_ORGANIZER_ID))
    expect(rows).toHaveLength(3)
    for (const service of rows) {
      expect(service.defaultPrice.length).toBeGreaterThan(0)
      expect(service.defaultCapacity).toBeGreaterThan(0)
      expect(service.defaultDurationMinutes).toBeGreaterThan(0)
      // options non-empty implies optionsSelectMode set (DB check constraint).
      if (service.options && service.options.length > 0) {
        expect(service.optionsSelectMode).toBeTruthy()
      }
    }
  })

  it('keeps every slot within capacity and upcoming slots strictly in the future', async () => {
    const { db, services, timeSlots } = requireDb()
    const slots = await db
      .select()
      .from(timeSlots)
      .where(
        inArray(
          timeSlots.serviceId,
          db
            .select({ id: services.id })
            .from(services)
            .where(eq(services.organizerId, DEMO_ORGANIZER_ID)),
        ),
      )
    expect(slots).toHaveLength(19)
    const now = Date.now()
    for (const slot of slots) {
      expect(slot.bookedCount).toBeLessThanOrEqual(slot.capacity)
      expect(slot.capacity).toBeGreaterThan(0)
      expect(slot.durationMinutes).toBeGreaterThan(0)
    }
    // Slots authored with dayOffset >= 0 resolve to "tomorrow at hour" —
    // strictly upcoming regardless of when the seed ran.
    const upcoming = slots.filter((s) => s.startsAt.getTime() > now)
    expect(upcoming.length).toBeGreaterThanOrEqual(10)
  })

  it('seeds bookings with hashed manage tokens and valid statuses', async () => {
    const { db, bookings, services, timeSlots } = requireDb()
    const slotRows = await db
      .select({ id: timeSlots.id })
      .from(timeSlots)
      .where(
        inArray(
          timeSlots.serviceId,
          db
            .select({ id: services.id })
            .from(services)
            .where(eq(services.organizerId, DEMO_ORGANIZER_ID)),
        ),
      )
    const rows = await db
      .select()
      .from(bookings)
      .where(
        inArray(
          bookings.timeSlotId,
          slotRows.map((s) => s.id),
        ),
      )
    expect(rows).toHaveLength(40)
    for (const booking of rows) {
      expect(['confirmed', 'cancelled']).toContain(booking.status)
      expect(booking.seats).toBeGreaterThanOrEqual(1)
      expect(booking.guestName.length).toBeGreaterThan(0)
      // SHA-256 hex (ADR-020): the credential check key, never the raw token.
      expect(booking.manageTokenHash).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('is idempotent — re-seeding replaces rows instead of accumulating', async () => {
    await requireDb().seedDemo()
    const first = await demoCounts()
    await requireDb().seedDemo()
    const second = await demoCounts()
    expect(second).toEqual(first)
    expect(second).toEqual({ organizers: 1, services: 3, slots: 19, bookings: 40 })
  })

  it('removeDemo clears the organizer and everything under it', async () => {
    await requireDb().removeDemo()
    expect(await demoCounts()).toEqual({ organizers: 0, services: 0, slots: 0, bookings: 0 })
    // Self-contained, not file-order-dependent: re-seed inside the test
    // so a test added after this one still sees the demo (this test must
    // otherwise stay last — `afterAll` alone restores only at file end).
    await requireDb().seedDemo()
    expect(await demoCounts()).toEqual({ organizers: 1, services: 3, slots: 19, bookings: 40 })
  })
})
