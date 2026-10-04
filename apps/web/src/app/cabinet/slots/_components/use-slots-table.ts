'use client'

import type { ServiceRecord, TimeSlotRecord } from '@repo/contracts'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import { toast } from 'sonner'

import { errorMessage, useDeleteSlot } from '@/api-client'
import { dayKeyOfInstant, dayKeyToDate, formatDayLabel } from '@/helpers/day-key'
import type { SlotDialogMode } from './slot-dialog'

/** What the dialog is currently doing, or `null` when it is closed. */
export type DialogState = { mode: SlotDialogMode; slot?: TimeSlotRecord } | null

type UseSlotsTableOptions = {
  slots: TimeSlotRecord[]
  services: ServiceRecord[]
  timezone: string
  nowIso: string
  activeServiceId?: string
  /** URL-derived filter state — the page parsed and validated each value. */
  day?: string
  showPast?: boolean
}

/**
 * The filtering, day-selection, delete and dialog state behind the slots table
 * — everything that is *not* rendering.
 *
 * Filter state lives in the URL (`?service=`, `?day=`, `?past=`) — the same
 * contract every cabinet filter uses, so views are shareable and back/forward
 * keep working. This hook only *writes* that state: every control is a
 * navigation. What stays local is what the URL has no business holding: the
 * open dialog and the pending delete.
 */
export function useSlotsTable({
  slots,
  services,
  timezone,
  nowIso,
  activeServiceId,
  day: dayParam,
  showPast: showPastParam,
}: UseSlotsTableOptions) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const locale = useLocale()
  const t = useTranslations('Cabinet.slots')
  const [dialog, setDialog] = useState<DialogState>(null)
  const [pendingDelete, setPendingDelete] = useState<TimeSlotRecord | null>(null)

  const day = dayParam ?? ''
  const showPast = showPastParam ?? false
  const dayLabel = day ? formatDayLabel(day, timezone, locale) : ''
  const dayOf = (slot: TimeSlotRecord) => dayKeyOfInstant(slot.startsAt, timezone)

  /**
   * Write filter changes back to the URL — navigation is how a control
   * commits. `replace` keeps back/forward meaningful at page level instead of
   * recording every chip click, and `scroll: false` holds the table in place.
   */
  const navigate = (updates: Record<string, string | undefined>) => {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  const setShowPast = (next: boolean) => navigate({ past: next ? '1' : undefined })

  const servicesById = new Map(services.map((service) => [service.id, service]))
  const activeService = activeServiceId ? servicesById.get(activeServiceId) : undefined

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
   * A day counts as past only if nothing upcoming shares it — the actionable
   * state wins.
   */
  const upcomingKeys = new Set(scopedByService.filter((slot) => slot.startsAt >= nowIso).map(dayOf))
  const upcomingDates = [...upcomingKeys].map(dayKeyToDate)
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
    if (next === '') {
      navigate({ day: undefined })
      return
    }

    const onDay = scopedByService.filter((slot) => dayOf(slot) === next)
    if (onDay.length === 0) {
      navigate({ day: next })
      return
    }
    navigate({ day: next, past: onDay.every((slot) => slot.startsAt < nowIso) ? '1' : undefined })
  }

  const deleteSlot = useDeleteSlot()

  const confirmDelete = () => {
    if (!pendingDelete) return
    deleteSlot.mutate(pendingDelete.id, {
      onSuccess: () => {
        toast.success(t('deletedToast'))
        setPendingDelete(null)
        router.refresh()
      },
      onError: (error) => toast.error(errorMessage(error, t('deleteFailed'))),
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
