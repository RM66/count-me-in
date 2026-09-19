'use client'

import type { CreateTimeSlotInput, UpdateTimeSlotInput } from '@repo/contracts'
import { deletedSlotEnvelope, slotEnvelope } from '@repo/contracts'
import { useMutation } from '@tanstack/react-query'

import { del, post, put } from './client'

/**
 * Client-side API for the **TimeSlot** entity.
 * The cabinet reads slots on the server (`lib/server/db/time-slot.ts`), so
 * there is no list/detail query here. The mutations return the created or
 * updated record; the caller follows with `router.refresh()` to re-render the
 * server component (Phase 2.3 — no client cache to invalidate).
 */

/** Create a slot under one of the signed-in organizer's services. */
export function useCreateSlot() {
  return useMutation({
    mutationFn: (input: CreateTimeSlotInput) => post('/api/slots', input, slotEnvelope),
  })
}

/** Update one slot. Only the fields present in `input` are written. */
export function useUpdateSlot(slotId: string) {
  return useMutation({
    mutationFn: (input: UpdateTimeSlotInput) =>
      put(`/api/slots/${slotId}`, input, slotEnvelope),
  })
}

/**
 * Delete one slot. Refused server-side (409) while the slot still has
 * confirmed bookings — the organizer must cancel them first.
 */
export function useDeleteSlot(slotId: string) {
  return useMutation({
    mutationFn: () => del(`/api/slots/${slotId}`, deletedSlotEnvelope),
  })
}
