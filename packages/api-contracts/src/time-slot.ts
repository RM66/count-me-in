import { z } from 'zod'

import { capacity, durationMinutes, priceText, serviceId, uuid } from './primitives'

/**
 * How far into the past a slot start may still be accepted.
 * Not zero, because the browser validates against its own clock and the server
 * re-validates against a different one a round trip later. Without a grace
 * window, "the next available minute" would pass in the form and fail on the
 * server whenever the two disagree or the request is slow.
 */
export const SLOT_START_TOLERANCE_MS = 60_000

/** Human-readable reason, shared by the form and the API so both say the same thing. */
export const SLOT_START_IN_PAST_MESSAGE =
  'Pick a time in the future — guests cannot book a session that has already started'

/**
 * Whether a slot may start at `startsAt`.
 * A slot in the past is not a harmless oddity: nobody can book it, and the
 * cabinet's schedule lists upcoming sessions, so such a row is written and then
 * immediately invisible. Rejecting it turns that silence into an error.
 */
export function isAcceptableSlotStart(startsAt: Date, now: Date = new Date()): boolean {
  return startsAt.getTime() > now.getTime() - SLOT_START_TOLERANCE_MS
}

export const createTimeSlotInput = z
  .object({
    serviceId,
    startsAt: z.coerce.date(),
    durationMinutes,
    capacity,
    price: priceText.optional(),
  })
  .refine(({ startsAt }) => isAcceptableSlotStart(startsAt), {
    path: ['startsAt'],
    message: SLOT_START_IN_PAST_MESSAGE,
  })
export type CreateTimeSlotInput = z.infer<typeof createTimeSlotInput>

/** Slot edits; a slot cannot be moved to a different service. */
export const updateTimeSlotInput = z
  .object({
    startsAt: z.coerce.date().optional(),
    durationMinutes: durationMinutes.optional(),
    capacity: capacity.optional(),
    price: priceText.nullable().optional(),
  })
  .refine(({ startsAt }) => startsAt === undefined || isAcceptableSlotStart(startsAt), {
    path: ['startsAt'],
    message: SLOT_START_IN_PAST_MESSAGE,
  })
export type UpdateTimeSlotInput = z.infer<typeof updateTimeSlotInput>

/**
 * A slot as returned by the API. Mirrors the `time_slots` table with dates
 * normalized to ISO strings so it can cross the server/client boundary.
 * `bookedCount` is read-only over the wire: seats are claimed by the atomic
 * reserve in the booking flow (invariant 2 in docs/domain.md), never by a
 * cabinet edit.
 */
export const timeSlotRecord = z.object({
  id: uuid,
  serviceId,
  startsAt: z.string(),
  durationMinutes,
  capacity,
  bookedCount: z.number().int().min(0),
  price: z.string().nullable(),
  createdAt: z.string(),
})
export type TimeSlotRecord = z.infer<typeof timeSlotRecord>

/**
 * Slot capacity rules.
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
  startsAt: string
  durationMinutes: number
}

/**
 * Remaining seats, floored at zero.
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
 * Prices are display text only in MVP — there are no payments.
 */
export function slotPrice(
  slot: { price?: string | null },
  service?: { defaultPrice?: string | null } | null,
): string {
  return slot.price ?? service?.defaultPrice ?? ''
}
