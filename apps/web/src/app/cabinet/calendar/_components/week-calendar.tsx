'use client'

import type { ServiceRecord, SlotFill, TimeSlotRecord } from '@repo/api-contracts'
import { fillLabel, instantToWallClockInputs, seatsLeft, slotEnd } from '@repo/api-contracts'
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'

import { dateToDayKey, DAY_MARK, dayKeyToDate } from '@/app/cabinet/_components/day-filter'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import {
  addDays,
  assignColumns,
  MINUTES_PER_DAY,
  startOfWeek,
  timeToMinutes,
} from './week-layout'

/** Pixels per hour row. The grid is a fixed 24 h tall and scrolls. */
const HOUR_HEIGHT = 48
const HOURS = Array.from({ length: 24 }, (_, hour) => hour)

/**
 * Event tint by fill status, so a full week reads at a glance: open sessions
 * sit quiet, filling ones lean on the brand colour, full ones grey out. The
 * left rule is the status marker (see day calendars generally), not decoration.
 */
const FILL_STYLES: Record<SlotFill, string> = {
  open: 'border-l-primary/50 bg-primary/10 text-foreground hover:bg-primary/15',
  filling: 'border-l-primary bg-primary/20 text-foreground hover:bg-primary/30',
  full: 'border-l-muted-foreground/40 bg-muted text-muted-foreground hover:bg-muted/70',
}

const FILL_LEGEND: { fill: SlotFill; label: string }[] = [
  { fill: 'open', label: 'Open' },
  { fill: 'filling', label: 'Filling up' },
  { fill: 'full', label: 'Full' },
]

type WeekCalendarProps = {
  slots: TimeSlotRecord[]
  services: ServiceRecord[]
  /** Organizer timezone — slots are instants, placed on the wall clock. */
  timezone: string
  /** "Now" as the server saw it, so today and the time line match on hydration. */
  nowIso: string
}

/**
 * The cabinet's Google-Calendar-style week view: a full-height time grid of the
 * current week beside a small month calendar for jumping between weeks.
 *
 * A client component because navigating weeks and scrolling the grid is all
 * interactive, but the **data is passed in** — the page reads Postgres and this
 * only lays it out. Slots are positioned purely by their wall-clock time in the
 * organizer's timezone, so the same evening session never drifts a column for a
 * viewer in another zone.
 */
export function WeekCalendar({ slots, services, timezone, nowIso }: WeekCalendarProps) {
  const servicesById = useMemo(
    () => new Map(services.map((service) => [service.id, service])),
    [services],
  )

  // Where "today" and "now" fall on the organizer's wall clock — the anchors
  // for the initial week, the highlighted column and the time line.
  const nowWall = useMemo(() => instantToWallClockInputs(nowIso, timezone), [nowIso, timezone])
  const todayKey = nowWall.date
  const nowMinutes = timeToMinutes(nowWall.time)

  // The day the mini calendar and week both hang off. Starts on today.
  const [selectedDate, setSelectedDate] = useState(() => dayKeyToDate(todayKey))
  const [month, setMonth] = useState(() => dayKeyToDate(todayKey))
  // The month picker now lives in a popover (like the "Any day" filter), so we
  // track its own open state and close it once a day is chosen.
  const [isPickerOpen, setPickerOpen] = useState(false)

  const goToDate = (date: Date) => {
    setSelectedDate(date)
    setMonth(date)
  }

  const weekStart = useMemo(() => startOfWeek(selectedDate), [selectedDate])
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

    for (const [dayKey, events] of raw) byDay.set(dayKey, assignColumns(events))
    return byDay
  }, [slots, timezone])

  // Days anywhere in the schedule that hold a session — marked in the mini
  // calendar so empty weeks are obvious before you navigate to them.
  const slotDates = useMemo(
    () => [...eventsByDay.keys()].map(dayKeyToDate),
    [eventsByDay],
  )

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

  const rangeLabel = formatRange(weekStart, addDays(weekStart, 6))

  return (
    <div className="flex h-[calc(100svh-4rem)] flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
        <p className="text-sm text-muted-foreground">
          Your week at a glance — every session on its start time and length.
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {/* The week grid, now full width — the month picker is tucked into the
            toolbar popover instead of a permanent side rail. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => goToDate(dayKeyToDate(todayKey))}>
                Today
              </Button>
              <div className="flex items-center">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={() => goToDate(addDays(weekStart, -7))}
                  aria-label="Previous week"
                >
                  <ChevronLeftIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={() => goToDate(addDays(weekStart, 7))}
                  aria-label="Next week"
                >
                  <ChevronRightIcon />
                </Button>
              </div>
              <span className="text-sm font-medium">{rangeLabel}</span>
            </div>

            <div className="flex items-center gap-3">
              {/* Legend, quiet on the right so a full week still reads at a glance. */}
              <dl className="hidden items-center gap-3 text-xs text-muted-foreground sm:flex">
                {FILL_LEGEND.map(({ fill, label }) => (
                  <div key={fill} className="flex items-center gap-1.5">
                    <span
                      className={cn('size-3 shrink-0 rounded-sm border-l-2', FILL_STYLES[fill])}
                      aria-hidden
                    />
                    <dt>{label}</dt>
                  </div>
                ))}
              </dl>

              {/* Month picker behind a button, mirroring the "Any day" filter. */}
              <Popover open={isPickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label="Jump to a week"
                  >
                    <CalendarIcon data-icon="inline-start" />
                    Jump to date
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    month={month}
                    onMonthChange={setMonth}
                    onSelect={(date) => {
                      if (!date) return
                      goToDate(date)
                      setPickerOpen(false)
                    }}
                    modifiers={{ hasSlots: slotDates, activeWeek: weekDays }}
                    modifiersClassNames={{
                      hasSlots: DAY_MARK.strong.calendarCell,
                      // Tint the whole selected week so the picker echoes the grid.
                      activeWeek: 'rounded-none bg-accent/60',
                    }}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* One horizontal scroll owner so day headers and the time grid stay
              aligned when the week is wider than the panel on small screens. */}
          <div className="min-h-0 flex-1 overflow-auto" ref={scrollRef}>
            <div className="min-w-[640px]">
              {/* Day headers, sticky so they survive the vertical scroll. */}
              <div className="sticky top-0 z-20 flex border-b bg-background">
                <div className="w-14 shrink-0" />
                {weekDays.map((day) => {
                  const dayKey = dateToDayKey(day)
                  const isToday = dayKey === todayKey
                  return (
                    <button
                      key={dayKey}
                      type="button"
                      onClick={() => goToDate(day)}
                      className="flex flex-1 flex-col items-center gap-0.5 py-2 text-center hover:bg-muted/50"
                    >
                      <span className="text-xs text-muted-foreground uppercase">
                        {day.toLocaleDateString('en-US', { weekday: 'short' })}
                      </span>
                      <span
                        className={cn(
                          'flex size-7 items-center justify-center rounded-full text-sm font-medium',
                          isToday && 'bg-primary text-primary-foreground',
                        )}
                      >
                        {day.getDate()}
                      </span>
                    </button>
                  )
                })}
              </div>

              {/* Time gutter + seven day columns, all the same fixed height. */}
              <div className="flex" style={{ height: 24 * HOUR_HEIGHT }}>
                <div className="w-14 shrink-0">
                  {HOURS.map((hour) => (
                    <div key={hour} className="relative" style={{ height: HOUR_HEIGHT }}>
                      {hour > 0 && (
                        <span className="absolute -top-2 right-2 text-xs text-muted-foreground tabular-nums">
                          {String(hour).padStart(2, '0')}:00
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                {weekDays.map((day) => {
                  const dayKey = dateToDayKey(day)
                  const events = eventsByDay.get(dayKey) ?? []
                  const isToday = dayKey === todayKey
                  return (
                    <div key={dayKey} className="relative flex-1 border-l">
                      {/* Hour lines. */}
                      {HOURS.map((hour) => (
                        <div
                          key={hour}
                          className="border-b border-border/60"
                          style={{ height: HOUR_HEIGHT }}
                        />
                      ))}

                      {/* Current-time line, only in today's column. */}
                      {isToday && (
                        <div
                          className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
                          style={{ top: (nowMinutes / 60) * HOUR_HEIGHT }}
                        >
                          <span className="size-2 shrink-0 rounded-full bg-destructive" />
                          <span className="h-px flex-1 bg-destructive" />
                        </div>
                      )}

                      {/* Sessions. */}
                      {events.map((event) => {
                        const slot = event.item
                        const service = servicesById.get(slot.serviceId)
                        const fill = fillLabel(slot)
                        const top = (event.startMin / 60) * HOUR_HEIGHT
                        const height = Math.max(
                          ((event.endMin - event.startMin) / 60) * HOUR_HEIGHT - 2,
                          18,
                        )
                        return (
                          <Link
                            key={slot.id}
                            href={`/cabinet/bookings?slot=${slot.id}`}
                            className={cn(
                              'absolute z-10 overflow-hidden rounded-sm border-l-2 px-1.5 py-1 text-xs transition-colors',
                              FILL_STYLES[fill],
                            )}
                            style={{
                              top,
                              height,
                              left: `calc(${(event.col / event.cols) * 100}% + 2px)`,
                              width: `calc(${100 / event.cols}% - 4px)`,
                            }}
                          >
                            <span className="block font-medium truncate">
                              {service?.title ?? 'Session'}
                            </span>
                            {height > 30 && (
                              <span className="block truncate text-[0.7rem] opacity-80">
                                {instantToWallClockInputs(slot.startsAt, timezone).time}–
                                {instantToWallClockInputs(slotEnd(slot), timezone).time} ·{' '}
                                {seatsLeft(slot)} left
                              </span>
                            )}
                          </Link>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Week range label, e.g. "Jul 21 – 27, 2026" or "Jul 28 – Aug 3, 2026". */
function formatRange(start: Date, end: Date): string {
  const sameMonth = start.getMonth() === end.getMonth()
  const startLabel = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const endLabel = end.toLocaleDateString(
    'en-US',
    sameMonth
      ? { day: 'numeric', year: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' },
  )
  return `${startLabel} – ${endLabel}`
}
