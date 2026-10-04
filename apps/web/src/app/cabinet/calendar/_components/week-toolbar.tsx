'use client'

import type { SlotFill } from '@repo/contracts'
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { DAY_MARK } from '@/app/cabinet/_components/day-filter'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { dateToDayKey, dayKeyToDate } from '@/helpers/day-key'
import type { WeekStartsOn } from '@/helpers/week-starts-on'
import { cn } from '@/lib/utils'
import { addDays, FILL_STYLES } from './week-layout'

type WeekToolbarProps = {
  /** First day of the displayed week — the range label's left edge. */
  weekStart: Date
  /** The seven days the grid renders — the picker's week tint. */
  weekDays: Date[]
  /** Today as a day key — the Today button's target. */
  todayKey: string
  /** Days holding a session — the picker's marks. */
  slotDates: Date[]
  /** The URL day the displayed week contains — the picker's selection. */
  dayKey: string
  weekStartsOn: WeekStartsOn
  locale: string
  /** Push a new `?day=` — same-week picks only move the selection. */
  onGoToDay: (day: string) => void
  /** A picked date also asks the grid to scroll its column into view. */
  onJumpToDate: (date: Date) => void
}

/** Week range label, e.g. "Jul 21 – 27, 2026" or "Jul 28 – Aug 3, 2026". */
function formatRange(start: Date, end: Date, locale: string): string {
  const sameMonth = start.getMonth() === end.getMonth()
  const startLabel = start.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
  const endLabel = end.toLocaleDateString(
    locale,
    sameMonth
      ? { day: 'numeric', year: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' },
  )
  return `${startLabel} – ${endLabel}`
}

/**
 * The calendar's toolbar: Today/prev/next navigation plus the range label on
 * the left, the fill-status legend and the month-picker popover on the right.
 * The picker is tucked into a popover (like the "Any day" filter) rather than
 * a permanent side rail so the grid keeps the full width.
 */
export function WeekToolbar({
  weekStart,
  weekDays,
  todayKey,
  slotDates,
  dayKey,
  weekStartsOn,
  locale,
  onGoToDay,
  onJumpToDate,
}: WeekToolbarProps) {
  const t = useTranslations('Cabinet.calendar')
  // The month picker now lives in a popover (like the "Any day" filter), so we
  // track its own open state and close it once a day is chosen.
  const [isPickerOpen, setPickerOpen] = useState(false)

  const FILL_LEGEND: { fill: SlotFill; label: string }[] = [
    { fill: 'open', label: t('open') },
    { fill: 'filling', label: t('fillingUp') },
    { fill: 'full', label: t('full') },
  ]

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => onJumpToDate(dayKeyToDate(todayKey))}>
          {t('today')}
        </Button>
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => onGoToDay(dateToDayKey(addDays(weekStart, -7)))}
            aria-label={t('previousWeek')}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => onGoToDay(dateToDayKey(addDays(weekStart, 7)))}
            aria-label={t('nextWeek')}
          >
            <ChevronRightIcon />
          </Button>
        </div>
        <span className="text-sm font-medium">
          {formatRange(weekStart, addDays(weekStart, 6), locale)}
        </span>
      </div>

      <div className="flex items-center gap-3">
        {/* Legend, quiet on the right so a full week still reads at a glance. */}
        <dl className="hidden items-center gap-3 text-xs text-muted-foreground sm:flex">
          {FILL_LEGEND.map(({ fill, label }) => (
            <div key={fill} className="flex items-center gap-1.5">
              <span
                className={cn('size-3 shrink-0 rounded-sm border-s-2', FILL_STYLES[fill])}
                aria-hidden
              />
              <dt>{label}</dt>
            </div>
          ))}
        </dl>

        {/* Month picker behind a button, mirroring the "Any day" filter. */}
        <Popover open={isPickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" aria-label={t('jumpToWeek')}>
              <CalendarIcon data-icon="inline-start" />
              {t('jumpToDate')}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="single"
              weekStartsOn={weekStartsOn}
              selected={dayKeyToDate(dayKey)}
              // Remounting on navigation resyncs the picker's month to
              // the displayed week without a controlled-month effect.
              key={dayKey}
              defaultMonth={dayKeyToDate(dayKey)}
              onSelect={(date) => {
                if (!date) return
                onJumpToDate(date)
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
  )
}
