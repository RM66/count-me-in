/**
 * Seed / refresh the read-only demo organizer (ADR-010).
 *
 *   bun run --filter @repo/db db:seed:demo
 *
 * Needs `DATABASE_URL`. The script runs with cwd `packages/db`, so the npm
 * script points Bun at the repo-root `.env` explicitly (`--env-file=../../.env`)
 * — Bun would otherwise only look for `.env` next to the package.
 *
 * Idempotent: safe to run repeatedly, and intended to run on a schedule so demo
 * slot times stay in the future. Re-running upserts the organizer and services
 * by their deterministic ids, then replaces slots and bookings wholesale.
 */

import { DEMO_ORGANIZER_ID } from '@repo/api-contracts'
import { eq, inArray } from 'drizzle-orm'

import { client, db } from '../client'
import { bookings, organizers, services, timeSlots } from '../schema'
import { buildDemoBookings, buildDemoSlots, demoOrganizer, demoServices } from './demo'

export async function seedDemo(now: Date = new Date()): Promise<void> {
  const slots = buildDemoSlots(now)
  const slotBookings = buildDemoBookings(now)

  await db.transaction(async (tx) => {
    // 1. Organizer — upsert so a refresh never duplicates or orphans children.
    await tx
      .insert(organizers)
      .values(demoOrganizer)
      .onConflictDoUpdate({
        target: organizers.id,
        set: {
          slug: demoOrganizer.slug,
          name: demoOrganizer.name,
          timezone: demoOrganizer.timezone,
          description: demoOrganizer.description,
          photoUrl: demoOrganizer.photoUrl,
          location: demoOrganizer.location,
          contact: demoOrganizer.contact,
        },
      })

    // 2. Services — upsert by fixed text id so public service URLs stay stable.
    for (const service of demoServices) {
      await tx
        .insert(services)
        .values(service)
        .onConflictDoUpdate({
          target: services.id,
          set: {
            title: service.title,
            description: service.description,
            photoUrl: service.photoUrl,
            location: service.location,
            contact: service.contact,
            defaultPrice: service.defaultPrice,
            defaultCapacity: service.defaultCapacity,
            defaultDurationMinutes: service.defaultDurationMinutes,
            options: service.options,
            optionsSelectMode: service.optionsSelectMode,
          },
        })
    }

    // 3. Slots + bookings are rebuilt rather than updated: their timestamps are
    //    all relative to `now`, so a refresh is a full replacement. Deleting the
    //    slots cascades to their bookings; bookings are deleted first anyway to
    //    keep the intent explicit.
    const demoServiceIds = demoServices.map((service) => service.id)

    const existingSlots = await tx
      .select({ id: timeSlots.id })
      .from(timeSlots)
      .where(inArray(timeSlots.serviceId, demoServiceIds))

    if (existingSlots.length > 0) {
      const existingSlotIds = existingSlots.map((slot) => slot.id)
      await tx.delete(bookings).where(inArray(bookings.timeSlotId, existingSlotIds))
      await tx.delete(timeSlots).where(inArray(timeSlots.id, existingSlotIds))
    }

    await tx.insert(timeSlots).values(slots)
    await tx.insert(bookings).values(slotBookings)
  })
}

/** Remove the demo organizer and everything under it (cascades). */
export async function removeDemo(): Promise<void> {
  await db.delete(organizers).where(eq(organizers.id, DEMO_ORGANIZER_ID))
}

// Executed directly (not imported) → run the seed and close the connection.
if (import.meta.main) {
  try {
    await seedDemo()
    console.log('[seed] demo organizer seeded — https://countmein.group/demo')
  } catch (error) {
    console.error('[seed] failed to seed demo organizer:', error)
    process.exitCode = 1
  } finally {
    await client.end()
  }
}
