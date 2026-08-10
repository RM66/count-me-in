'use client'

import type { ServiceRecord, TimeSlotRecord } from '@repo/api-contracts'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import { useDeleteSlot } from '@/api-client'
import { DAY_MARK, dayKeyToDate, useDayFilter } from '@/app/cabinet/_components/day-filter'
import type { SlotDialogMode } from './slot-dialog'

/** What the dialog is currently doing, or `null` when it is closed. */
export type DialogState = { mode: SlotDialogMode; slot?: TimeSlotRecord } | null

type UseSlotsTableOptions = {
  slots: TimeSlotRecord[]
  services: ServiceRecord[]
  timezone: string
  nowIso: string
  activeServiceId?: string
}

export { DAY_MARK, dayKeyToDate }

/**
 * The filtering, day-selection, delete and dialog state behind the slots table
 * — everything that is *not* rendering.
 *
 * Extracted from [`SlotsTable`](slots-table.tsx) so the component is left with
 * the table markup and this hook can be tested in isolation.
 */
export function useSlotsTable({
  slots,
  services,
  timezone,
  nowIso,
  activeServiceId,
}: UseSlotsTableOptions) {
  const router = useRouter()
  const [dialog, setDialog] = useState<DialogState>(null)
  const [pendingDelete, setPendingDelete] = useState<TimeSlotRecord | null>(null)
  const [showPast, setShowPast] = useState(false)
  const { day, setDay, dayLabel, dayKeyOf } = useDayFilter(timezone)

  const servicesById = new Map(services.map((service) => [service.id, service]))
  const activeService = activeServiceId ? servicesById.get(activeServiceId) : undefined

  const dayOf = (slot: TimeSlotRecord) => dayKeyOf(slot.startsAt)

  // Service filter first, so the Upcoming/Past counts describe what the
  // organizer is actually looking at rather than the whole schedule.
  const scopedByService = activeServiceId
    ? slots.filter((slot) => slot.serviceId === activeServiceId)
    : slots
  const scoped = scopedByService.filter((slot) => day === '' || dayOf(slot) === day)

  // Past sessions stay reachable behind a toggle rather than being dropped: a
  // slot saved with a stale date would otherwise just never appear, which
  // reads as "the save failed".
  const upcoming = scoped.filter((slot) => slot.startsAt >= nowIso)
  const past = scoped.filter((slot) => slot.startsAt < nowIso)
  const visible = showPast ? past : upcoming

  /**
   * Which days to mark in the picker — the reason it exists rather than the
   * native control, which cannot say anything about a day's contents.
   *
   * Marks follow the **service filter**: while scoped to one service, the
   * calendar answers "when does *this* run", not "when does anything run".
   */
  const upcomingDates = [
    ...new Set(scopedByService.filter((slot) => slot.startsAt >= nowIso).map(dayOf)),
  ].map(dayKeyToDate)

  // A day counts as past only if nothing upcoming shares it, so a day holding
  // both is marked as upcoming — the actionable state wins.
  const upcomingKeys = new Set(scopedByService.filter((slot) => slot.startsAt >= nowIso).map(dayOf))
  const pastDates = [
    ...new Set(
      scopedByService
        .filter((slot) => slot.startsAt < nowIso)
        .map(dayOf)
        .filter((key) => !upcomingKeys.has(key)),
    ),
  ].map(dayKeyToDate)

  /**
   * Which month to open on: the next session, else now. (A selected day wins —
   * the picker handles that itself.)
   *
   * Deliberately *not* the earliest scheduled date — that is the oldest past
   * session, so the calendar would open on a bygone month with none of the
   * upcoming marks in view.
   */
  const firstUpcoming = [...upcomingDates].sort((a, b) => a.getTime() - b.getTime())[0]
  const defaultMonth = firstUpcoming ?? new Date(nowIso)

  /**
   * Picking a day also switches Upcoming/Past when the chosen day only has
   * sessions on the other side of "now" — otherwise selecting a past date
   * lands on an empty "Upcoming" tab and looks like the filter found nothing.
   */
  const selectDay = (next: string) => {
    setDay(next)
    if (next === '') return

    const onDay = scopedByService.filter((slot) => dayOf(slot) === next)

    if (onDay.length === 0) return
    setShowPast(onDay.every((slot) => slot.startsAt < nowIso))
  }

  // The id is bound at hook level, so the dialog owns the pending slot and the
  // mutation is re-created as the selection changes.
  const deleteSlot = useDeleteSlot(pendingDelete?.id ?? '')

  const confirmDelete = () => {
    deleteSlot.mutate(undefined, {
      onSuccess: () => {
        toast.success('Slot cancelled')
        setPendingDelete(null)
        router.refresh()
      },
      onError: (error) => toast.error(error.message || 'Failed to cancel the slot'),
    })
  }

  return {
    dialog,
    setDialog,
    pendingDelete,
    setPendingDelete,
    showPast,
    setShowPast,
    day,
    dayLabel,
    selectDay,
    scopedByService,
    upcoming,
    past,
    visible,
    upcomingDates,
    pastDates,
    defaultMonth,
    servicesById,
    activeService,
    deleteSlot,
    confirmDelete,
  }
}
