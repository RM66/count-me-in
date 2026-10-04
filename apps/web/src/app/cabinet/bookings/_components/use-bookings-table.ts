'use client'

import type { ServiceRecord, TimeSlotRecord } from '@repo/contracts'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useLocale } from 'next-intl'
import { useEffect, useMemo, useRef, useState } from 'react'

import { dayKeyToDate, formatDayLabel } from '@/helpers/day-key'
import type { SortKey } from './sort'

export type BookingStatusFilter = 'all' | 'confirmed' | 'cancelled'

/** Delay before the search box lands in `?q=` — one fetch per pause, not per keystroke. */
const SEARCH_DEBOUNCE_MS = 300

type UseBookingsTableOptions = {
  slots: TimeSlotRecord[]
  services: ServiceRecord[]
  timezone: string
  activeServiceId?: string
  /** URL-derived filter state — the page parsed and validated each value. */
  status?: Exclude<BookingStatusFilter, 'all'>
  query?: string
  day?: string
  sort?: SortKey
  dir?: 'asc' | 'desc'
  /** Scoped day keys from the API — the picker's marks. */
  bookedDays: string[]
}

/**
 * The bookings table's filter plumbing — everything that is *not* rendering.
 *
 * Filter state lives in the URL (`?service=`, `?slot=`, `?status=`, `?q=`,
 * `?day=`, `?sort=`, `?dir=`, `?page=`): the API answers exactly the view the
 * URL describes, so the page of 50 rows arrives already filtered, sorted and
 * paginated. This hook only *writes* that state — every control is a
 * navigation — and derives display props (marks, labels, hrefs) from it.
 * What remains ephemeral: the search box's uncommitted text and the details
 * sheet's open row.
 */
export function useBookingsTable({
  slots,
  services,
  timezone,
  activeServiceId,
  status,
  query,
  day,
  sort,
  dir,
  bookedDays,
}: UseBookingsTableOptions) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const locale = useLocale()

  const slotsById = new Map(slots.map((slot) => [slot.id, slot]))
  const servicesById = new Map(services.map((service) => [service.id, service]))
  const activeService = activeServiceId ? servicesById.get(activeServiceId) : undefined

  /** The service a booking's slot belongs to — Booking has no serviceId. */
  const serviceOf = (booking: { timeSlotId: string }): ServiceRecord | undefined => {
    const slot = slotsById.get(booking.timeSlotId)
    return slot ? servicesById.get(slot.serviceId) : undefined
  }

  /**
   * Write filter changes back to the URL — navigation is how a control
   * commits. `replace` keeps back/forward meaningful at page level instead
   * of recording every chip click, and `scroll: false` holds the table in
   * place. Any change except pagination itself resets `?page`.
   */
  const navigate = (updates: Record<string, string | undefined>) => {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    if (!('page' in updates)) params.delete('page')
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate

  // ── Status filter ──────────────────────────────────────────────────────
  const filter: BookingStatusFilter = status ?? 'all'
  const setFilter = (next: BookingStatusFilter) =>
    navigate({ status: next === 'all' ? undefined : next })

  // ── Day filter ─────────────────────────────────────────────────────────
  const dayValue = day ?? ''
  const dayLabel = dayValue ? formatDayLabel(dayValue, timezone, locale) : ''
  const setDay = (next: string) => navigate({ day: next || undefined })

  /**
   * Which days the picker marks — the API computed them over the scoped
   * bookings (a truncated page could never answer "which days have
   * bookings").
   */
  const bookedDates = useMemo(() => bookedDays.map(dayKeyToDate), [bookedDays])

  /**
   * Which month to open on: the next booked session, else the most recent
   * one, else today. The popover mounts only after a click, so reading the
   * client clock here cannot cause a hydration mismatch.
   */
  const defaultMonth = useMemo(() => {
    const sorted = [...bookedDates].sort((a, b) => a.getTime() - b.getTime())
    return sorted.find((date) => date.getTime() >= Date.now()) ?? sorted.at(-1) ?? new Date()
  }, [bookedDates])

  // ── Search ─────────────────────────────────────────────────────────────
  /**
   * The input keeps its own uncommitted text; the debounce writes `?q=` on a
   * pause. `submittedQueryRef` records what we sent, so the sync below only
   * overwrites the box when the URL changed *externally* (back/forward or a
   * filter-chip clear) — a navigation answering our own debounce must not
   * clobber what the user typed since.
   */
  const [search, setSearch] = useState(query ?? '')
  const submittedQueryRef = useRef(query ?? '')
  useEffect(() => {
    const next = query ?? ''
    if (next === submittedQueryRef.current) return
    submittedQueryRef.current = next
    setSearch(next)
  }, [query])
  useEffect(() => {
    const value = search.trim()
    if (value === (query ?? '')) return
    const timer = setTimeout(() => {
      submittedQueryRef.current = value
      navigateRef.current({ q: value || undefined })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search, query])

  // ── Column sort ────────────────────────────────────────────────────────
  /** Active column sort (missing `dir` reads as asc), or `null` for server order. */
  const sortState = sort ? ({ key: sort, dir: dir ?? 'asc' } as const) : null

  /** Cycle a column: unsorted → ascending → descending → unsorted. */
  const toggleSort = (key: SortKey) => {
    if (sort !== key) navigate({ sort: key, dir: 'asc' })
    else if (dir === 'desc') navigate({ sort: undefined, dir: undefined })
    else navigate({ dir: 'desc' })
  }

  // ── Pagination ─────────────────────────────────────────────────────────
  /** Page links preserve every active filter — a page turn resets nothing. */
  const pageHref = (target: number) => {
    const params = new URLSearchParams(searchParams.toString())
    if (target > 1) params.set('page', String(target))
    else params.delete('page')
    const qs = params.toString()
    return qs ? `${pathname}?${qs}` : pathname
  }

  return {
    filter,
    setFilter,
    search,
    setSearch,
    sortState,
    toggleSort,
    day: dayValue,
    setDay,
    dayLabel,
    bookedDates,
    defaultMonth,
    pageHref,
    slotsById,
    servicesById,
    serviceOf,
    activeService,
  }
}
