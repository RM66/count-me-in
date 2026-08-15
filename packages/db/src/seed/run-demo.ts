import { DEMO_ORGANIZER_ID } from '@repo/contracts'
import { eq, inArray } from 'drizzle-orm'

import { client, db } from '../client'
import { bookings, organizers, services, timeSlots } from '../schema'
import { buildDemoBookings, buildDemoSlots, demoOrganizer, demoServices } from './demo'

/**
 * Seed / refresh the read-only demo organizer (ADR-010).
 * Idempotent: safe to run repeatedly, and intended to run on a schedule so demo
 * slot times stay in the future. Re-running upserts the organizer and services
 * by their deterministic ids, then replaces slots and bookings wholesale.
 */
export async function seedDemo(now: Date = new Date()): Promise<void> {
  const slots = buildDemoSlots(now)
  const slotBookings = buildDemoBookings(now)

  await db.transaction(async (tx) => {
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
