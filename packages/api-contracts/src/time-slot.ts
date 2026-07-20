import { z } from 'zod'
import { capacity, durationMinutes, priceText, serviceId } from './primitives.js'

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
