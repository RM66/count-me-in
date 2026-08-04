'use client'

import type { CreateTimeSlotInput, TimeSlotRecord, UpdateTimeSlotInput } from '@repo/api-contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { del, post, put } from './client'
import { queryKeys } from './keys'

/**
 * Client-side API for the **TimeSlot** entity.
 * The cabinet reads slots on the server (`lib/server/db/time-slot.ts`), so
 * there is no list/detail query here yet; the mutations still have to drop
 * that cache when a server component refetches.
 *
 * Slot writes also invalidate **services**: the services list shows an upcoming
 * slot count per card, so adding or deleting a slot changes it.
 */

function invalidateSlots(queryClient: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.slots.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.services.all }),
  ])
}

/** Create a slot under one of the signed-in organizer's services. */
export function useCreateSlot() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateTimeSlotInput) => post<{ slot: TimeSlotRecord }>('/api/slots', input),
    onSuccess: () => invalidateSlots(queryClient),
  })
}

/** Update one slot. Only the fields present in `input` are written. */
export function useUpdateSlot(slotId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: UpdateTimeSlotInput) =>
      put<{ slot: TimeSlotRecord }>(`/api/slots/${slotId}`, input),
    onSuccess: () => invalidateSlots(queryClient),
  })
}

/** Delete one slot. Bookings cascade server-side. */
export function useDeleteSlot(slotId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => del<{ id: string }>(`/api/slots/${slotId}`),
    onSuccess: () => invalidateSlots(queryClient),
  })
}
