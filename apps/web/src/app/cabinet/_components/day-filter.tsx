'use client'

import { CalendarIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { dateToDayKey, dayKeyToDate } from '@/helpers/day-key'
import { useWeekStartsOn } from '@/hooks/use-week-starts-on'

/**
 * Shared "filter by day" controls for cabinet tables (slots, bookings).
 *
 * Each table decides *what a day contains* — which days get marked, and what
 * the legend says — while everything a day *is* lives here: the `YYYY-MM-DD`
 * key in the organizer's timezone and the popover shell. The pure date/key
 * conversions are in [`helpers/day-key`](../../../helpers/day-key.ts); the
 * active-day chip is the shared [`FilterChip`](./filter-chip.tsx).
 */

/**
 * Day-mark styling, shared so every cabinet calendar speaks the same visual
 * language: `strong` = actionable content on that day, `muted` = only history.
 *
 * `calendarCell` classes land on the day's `<td>`, but the visible day is the
 * `<button>` inside it — styling the cell alone leaves the number untouched
 * and nothing appears. Hence the child selector. `legend` mirrors the same
 * styling on a plain `<span>` so the key is self-evident.
 *
 * `strong` marks a day by turning the *number itself* the brand colour rather
 * than underlining it — a selected day (white on a solid brand fill) still
 * wins, since its own `data-selected` rule outranks this descendant class.
 * `muted` stays a dotted underline: history is a different kind of mark, not a
 * quieter shade of the same one.
 */
export const DAY_MARK = {
  strong: {
    calendarCell: '[&_button]:font-bold [&_button]:text-primary',
    legend: 'font-bold text-primary',
  },
  muted: {
    calendarCell:
      '[&_button]:underline [&_button]:decoration-dotted [&_button]:underline-offset-4 [&_button]:opacity-60',
    legend: 'underline decoration-dotted underline-offset-4 opacity-60',
  },
} as const

type DayFilterPickerProps = {
  /** Selected day key, `''` for "any day". */
  day: string
  /** Human label for the selected day (see `formatDayLabel` in helpers/day-key). */
  dayLabel: string
  /** Called with the picked day key, or `''` to clear. */
  onSelect: (dayKey: string) => void
  /** Which days to mark, keyed by modifier name — the table's domain knowledge. */
  modifiers: Record<string, Date[]>
  /** Cell classes per modifier name; compose from {@link DAY_MARK}. */
  modifiersClassNames: Record<string, string>
  /** Month to open on when nothing is selected — the table knows its data. */
  defaultMonth: Date
  /** Accessible name of what is being filtered, e.g. "slots" or "bookings". */
  entityLabel: string
}

/**
 * The calendar trigger + popover.
 *
 * Replaces the native `<input type="date">`: the browser's own picker cannot
 * mark which days have content, and that is the question an organizer is
 * actually asking when they open a calendar here. What counts as "content" is
 * the caller's business — it arrives via `modifiers` and `legend`.
 */
export function DayFilterPicker({
  day,
  dayLabel,
  onSelect,
  modifiers,
  modifiersClassNames,
  defaultMonth,
  entityLabel,
}: DayFilterPickerProps) {
  const [isOpen, setOpen] = useState(false)
  const weekStartsOn = useWeekStartsOn()
  const t = useTranslations('Cabinet.dayFilter')

  const selectedDate = day ? dayKeyToDate(day) : undefined

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={
            day ? t('changeDay', { day: dayLabel }) : t('filterByDay', { entity: entityLabel })
          }
        >
          <CalendarIcon data-icon="inline-start" />
          {day ? dayLabel : t('anyDay')}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <Calendar
          mode="single"
          weekStartsOn={weekStartsOn}
          // Only honoured while nothing is selected; a selected day wins.
          defaultMonth={selectedDate ?? defaultMonth}
          selected={selectedDate}
          onSelect={(picked) => {
            onSelect(picked ? dateToDayKey(picked) : '')
            setOpen(false)
          }}
          modifiers={modifiers}
          modifiersClassNames={modifiersClassNames}
        />
        {day && (
          <div className="border-t p-3">
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => {
                onSelect('')
                setOpen(false)
              }}
            >
              {t('showEveryDay')}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
