import { z } from 'zod'

import { capacity, durationMinutes, priceText, serviceId } from './primitives'

export const createTimeSlotInput = z.object({
  serviceId,
  startsAt: z.coerce.date(),
  durationMinutes,
  capacity,
  price: priceText.optional(),
})
export type CreateTimeSlotInput = z.infer<typeof createTimeSlotInput>

/** Slot edits; a slot cannot be moved to a different service. */
export const updateTimeSlotInput = z.object({
  startsAt: z.coerce.date().optional(),
  durationMinutes: durationMinutes.optional(),
  capacity: capacity.optional(),
  price: priceText.nullable().optional(),
})
export type UpdateTimeSlotInput = z.infer<typeof updateTimeSlotInput>

/**
 * Slot capacity rules.
 *
 * These live here rather than in `apps/web` because they are **isomorphic**:
 * the public page, the cabinet and the notification worker must all agree on
 * when a slot counts as full. They take structural shapes rather than a schema
 * type so both an API `TimeSlot` DTO and a row read straight from Postgres
 * satisfy them.
 */

/** Everything needed to judge how full a slot is. */
export interface SlotOccupancy {
  capacity: number
  bookedCount: number
}

/** Everything needed to place a slot on a timeline. */
export interface SlotTiming {
  /** ISO 8601 instant. */
  startsAt: string
  durationMinutes: number
}

/**
 * Remaining seats, floored at zero.
 *
 * `bookedCount` should never exceed `capacity` (a CHECK constraint enforces it),
 * but a negative number rendered as "-2 seats left" would be a worse failure
 * than silently showing "full".
 */
export function seatsLeft(slot: SlotOccupancy): number {
  return Math.max(0, slot.capacity - slot.bookedCount)
}

/** Fraction of capacity at or below which a slot is advertised as "filling". */
export const SLOT_FILLING_THRESHOLD = 0.25

export type SlotFill = 'open' | 'filling' | 'full'

/**
 * How full a slot is, as a label for badges and copy.
 *
 * The "filling" band is proportional, not a fixed seat count: 3 seats left out
 * of 4 is nearly full, out of 40 it is not.
 */
export function fillLabel(slot: SlotOccupancy): SlotFill {
  const left = seatsLeft(slot)
  if (left === 0) return 'full'
  if (left <= Math.ceil(slot.capacity * SLOT_FILLING_THRESHOLD)) return 'filling'
  return 'open'
}

/**
 * End instant of a slot as an ISO string.
 *
 * `endsAt` is deliberately not a column (see the `time_slots` schema) — it is
 * always `startsAt + durationMinutes`, and storing it would allow the two to
 * disagree.
 */
export function slotEnd(slot: SlotTiming): string {
  const start = new Date(slot.startsAt)
  return new Date(start.getTime() + slot.durationMinutes * 60_000).toISOString()
}

/**
 * Display price for a slot: its own override when set, otherwise the service's
 * default. Returns an empty string when neither exists.
 *
 * Prices are display text only in MVP — there are no payments, so this is never
 * used for arithmetic.
 */
export function slotPrice(
  slot: { price?: string | null },
  service?: { defaultPrice?: string | null } | null,
): string {
  return slot.price ?? service?.defaultPrice ?? ''
}
