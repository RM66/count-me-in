'use client'

import type { ServiceRecord, TimeSlotRecord } from '@repo/contracts'
import { fillLabel, instantToWallClockInputs, seatsLeft, slotEnd } from '@repo/contracts'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import type { Ref } from 'react'

import { dateToDayKey } from '@/helpers/day-key'
import { cn } from '@/lib/utils'
import { FILL_STYLES, HOUR_HEIGHT, HOURS, type PlacedEvent } from './week-layout'

type WeekGridProps = {
  weekDays: Date[]
  todayKey: string
  /** Wall-clock minutes since midnight for `now` — drives the now-line. */
  nowMinutes: number
  /** Laid-out sessions by day key — only days the week shows appear. */
  eventsByDay: ReadonlyMap<string, PlacedEvent<TimeSlotRecord>[]>
  servicesById: ReadonlyMap<string, ServiceRecord>
  timezone: string
  locale: string
  /** Push a new `?day=` — header clicks keep the day/week URL state. */
  onGoToDay: (day: string) => void
  /** One horizontal scroll owner so headers and grid scroll together. */
  scrollRef: Ref<HTMLDivElement>
  /** Per-day column refs so the parent can scroll a picked day into view. */
  columnRef: (day: string, el: HTMLDivElement | null) => void
}

/**
 * The scrollable week grid itself: sticky day headers above a 24-hour gutter
 * and seven columns where sessions are absolutely positioned by wall-clock
 * time in the organizer's timezone.
 */
export function WeekGrid({
  weekDays,
  todayKey,
  nowMinutes,
  eventsByDay,
  servicesById,
  timezone,
  locale,
  onGoToDay,
  scrollRef,
  columnRef,
}: WeekGridProps) {
  const t = useTranslations('Cabinet.calendar')
  const tc = useTranslations('Cabinet.common')

  return (
    <div className="min-h-0 flex-1 overflow-auto" ref={scrollRef}>
      <div className="min-w-306 md:min-w-160">
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
                onClick={() => onGoToDay(dayKey)}
                className="flex flex-1 flex-col items-center gap-0.5 py-2 text-center hover:bg-muted/50"
              >
                <span className="text-xs text-muted-foreground uppercase">
                  {day.toLocaleDateString(locale, { weekday: 'short' })}
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
                  <span className="absolute -top-2 end-2 text-xs text-muted-foreground tabular-nums">
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
              <div
                key={dayKey}
                ref={(el) => columnRef(dayKey, el)}
                className="relative flex-1 border-l"
              >
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
                        'absolute z-10 overflow-hidden rounded-sm border-s-2 px-1.5 py-1 text-xs transition-colors',
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
                        {service?.title ?? tc('session')}
                      </span>
                      {height > 30 && (
                        <span className="block truncate text-[0.7rem] opacity-80">
                          {instantToWallClockInputs(slot.startsAt, timezone).time}–
                          {instantToWallClockInputs(slotEnd(slot), timezone).time} ·{' '}
                          {t('left', { count: seatsLeft(slot) })}
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
  )
}
