'use client'

import type { ServiceRecord, TimeSlotRecord } from '@repo/contracts'
import { instantToWallClockInputs } from '@repo/contracts'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useMemo, useRef, useState } from 'react'

import { dateToDayKey, dayKeyToDate } from '@/helpers/day-key'
import { useWeekStartsOn } from '@/hooks/use-week-starts-on'
import { WeekGrid } from './week-grid'
import {
  addDays,
  assignColumns,
  HOUR_HEIGHT,
  MINUTES_PER_DAY,
  startOfWeek,
  timeToMinutes,
} from './week-layout'
import { WeekToolbar } from './week-toolbar'

type WeekCalendarProps = {
  /** Sessions inside the displayed week only — the page bounds the fetch. */
  slots: TimeSlotRecord[]
  /** Every day in the schedule that holds a session — the picker's marks. */
  slotDays: string[]
  services: ServiceRecord[]
  /** Organizer timezone — slots are instants, placed on the wall clock. */
  timezone: string
  /** "Now" as the server saw it, so today and the time line match on hydration. */
  nowIso: string
  /**
   * The day the displayed week contains — URL state (`?day=`), so back/forward
   * and shared links work like the other cabinet filters.
   */
  dayKey: string
}

/**
 * The cabinet's Google-Calendar-style week view: a full-height time grid of
 * the week containing `dayKey`, with a toolbar carrying navigation, legend,
 * and a month-picker popover.
 *
 * A client component because scrolling the grid is interactive, but **data and
 * the displayed week come from the page** — navigating pushes `?day=` and the
 * server refetches that week's sessions, so the schedule's history never has
 * to ship to the browser. Slots are positioned purely by their wall-clock time
 * in the organizer's timezone, so the same evening session never drifts a
 * column for a viewer in another zone.
 */
export function WeekCalendar({
  slots,
  slotDays,
  services,
  timezone,
  nowIso,
  dayKey,
}: WeekCalendarProps) {
  const t = useTranslations('Cabinet.calendar')
  const locale = useLocale()
  const router = useRouter()

  const servicesById = useMemo(
    () => new Map(services.map((service) => [service.id, service])),
    [services],
  )

  // Where "today" and "now" fall on the organizer's wall clock — the anchors
  // for the highlighted column and the time line.
  const nowWall = useMemo(() => instantToWallClockInputs(nowIso, timezone), [nowIso, timezone])
  const todayKey = nowWall.date
  const nowMinutes = timeToMinutes(nowWall.time)

  // The displayed week hangs off the URL's day, not local state: navigation
  // is a `?day=` push and the page answers with that week's sessions.
  const selectedDate = dayKeyToDate(dayKey)

  const goToDay = (day: string) => {
    router.push(`/cabinet/calendar?day=${day}`)
  }

  // Day columns register themselves here so picking a date can scroll the grid
  // horizontally to that column, not just switch the week. The scroll is
  // deferred to an effect because the target column may only exist after the
  // week (and therefore the columns) has re-rendered.
  const dayColumnRefs = useRef(new Map<string, HTMLDivElement | null>())
  const [pendingScrollDay, setPendingScrollDay] = useState<string | null>(null)

  const jumpToDate = (date: Date) => {
    const key = dateToDayKey(date)
    goToDay(key)
    setPendingScrollDay(key)
  }

  // Locale-driven first day of the week, shared with the mini picker so both
  // start the week on the same day (Sunday in en-US, Monday in ru-RU, etc.).
  const weekStartsOn = useWeekStartsOn()
  const weekStart = useMemo(
    () => startOfWeek(selectedDate, weekStartsOn),
    [selectedDate, weekStartsOn],
  )
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart],
  )
  const weekDayKeys = useMemo(() => weekDays.map(dateToDayKey), [weekDays])

  // Every slot pre-split to its wall-clock day and minute span once, so the
  // per-column render is a cheap Map lookup.
  const eventsByDay = useMemo(() => {
    const byDay = new Map<string, ReturnType<typeof assignColumns<TimeSlotRecord>>>()
    const raw = new Map<string, { item: TimeSlotRecord; startMin: number; endMin: number }[]>()

    for (const slot of slots) {
      const startWall = instantToWallClockInputs(slot.startsAt, timezone)
      const startMin = timeToMinutes(startWall.time)
      // Clamp the end to midnight rather than spilling into the next column —
      // a slot crossing midnight is vanishingly rare and not worth splitting.
      const endMin = Math.min(startMin + slot.durationMinutes, MINUTES_PER_DAY)
      const bucket = raw.get(startWall.date) ?? []
      bucket.push({ item: slot, startMin, endMin: Math.max(endMin, startMin + 15) })
      raw.set(startWall.date, bucket)
    }

    for (const [day, events] of raw) byDay.set(day, assignColumns(events))
    return byDay
  }, [slots, timezone])

  // Days anywhere in the schedule that hold a session — marked in the mini
  // calendar so empty weeks are obvious before you navigate to them. Comes
  // from the API: the fetched `slots` only cover the displayed week.
  const slotDates = useMemo(() => slotDays.map(dayKeyToDate), [slotDays])

  // Scroll the grid to the first session of the week (or the working morning)
  // whenever the week changes, so the interesting rows are in view without a
  // manual scroll past a dead night.
  const scrollRef = useRef<HTMLDivElement>(null)
  const firstEventMinute = useMemo(() => {
    const starts = weekDayKeys.flatMap((key) => eventsByDay.get(key)?.map((e) => e.startMin) ?? [])
    return starts.length > 0 ? Math.min(...starts) : 8 * 60
  }, [weekDayKeys, eventsByDay])

  useEffect(() => {
    if (!scrollRef.current) return
    const target = Math.max(0, (firstEventMinute - 30) / 60) * HOUR_HEIGHT
    scrollRef.current.scrollTop = target
  }, [firstEventMinute])

  // After a date is picked, centre its column in the (possibly overflowing)
  // grid. Runs once the new week's columns exist; the browser clamps the value
  // so desktop weeks that already fit simply don't move.
  useEffect(() => {
    if (!pendingScrollDay) return
    const container = scrollRef.current
    const column = dayColumnRefs.current.get(pendingScrollDay)
    if (container && column) {
      const containerRect = container.getBoundingClientRect()
      const columnRect = column.getBoundingClientRect()
      const delta =
        columnRect.left - containerRect.left - (containerRect.width - columnRect.width) / 2
      container.scrollBy({ left: delta, behavior: 'smooth' })
    }
    setPendingScrollDay(null)
  }, [pendingScrollDay])

  return (
    <div className="flex h-[calc(100svh-4rem)] flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
          <WeekToolbar
            weekStart={weekStart}
            weekDays={weekDays}
            todayKey={todayKey}
            slotDates={slotDates}
            dayKey={dayKey}
            weekStartsOn={weekStartsOn}
            locale={locale}
            onGoToDay={goToDay}
            onJumpToDate={jumpToDate}
          />
          <WeekGrid
            weekDays={weekDays}
            todayKey={todayKey}
            nowMinutes={nowMinutes}
            eventsByDay={eventsByDay}
            servicesById={servicesById}
            timezone={timezone}
            locale={locale}
            onGoToDay={goToDay}
            scrollRef={scrollRef}
            columnRef={(day, el) => {
              dayColumnRefs.current.set(day, el)
            }}
          />
        </div>
      </div>
    </div>
  )
}
