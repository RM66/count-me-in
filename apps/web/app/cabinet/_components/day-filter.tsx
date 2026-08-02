'use client'

import { instantToWallClockInputs, wallClockToInstant } from '@repo/api-contracts'
import { CalendarIcon, XIcon } from 'lucide-react'
import { type ReactNode, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatDate } from '@/lib/helpers/date'

/**
 * Shared "filter by day" control for cabinet tables (slots, bookings).
 *
 * Each table decides *what a day contains* — which days get marked, and what
 * the legend says — while everything a day *is* lives here: the `YYYY-MM-DD`
 * key in the organizer's timezone, its conversion to the picker's local
 * `Date`s, the human label, the chip, and the popover shell.
 */

/**
 * Bridge between the two date worlds around the picker.
 *
 * A day key is a *label* in the organizer's timezone; `DayPicker` works in
 * plain local `Date`s. Converting a key with `new Date(key)` would parse it as
 * UTC midnight and shift the highlight a day west of Greenwich, so the parts
 * are handed to the local constructor instead — the calendar square for "the
 * 2nd" is the same square whatever the browser's zone.
 */
export function dayKeyToDate(key: string): Date {
  return new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)))
}

/** Local calendar `Date` → `YYYY-MM-DD` day key. Inverse of {@link dayKeyToDate}. */
export function dateToDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`
}

/**
 * Day-mark styling, shared so every cabinet calendar speaks the same visual
 * language: `strong` = actionable content on that day, `muted` = only history.
 *
 * `calendarCell` classes land on the day's `<td>`, but the visible day is the
 * `<button>` inside it — styling the cell alone leaves the number untouched
 * and nothing appears. Hence the child selector. `legend` mirrors the same
 * styling on a plain `<span>` so the key is self-evident.
 */
export const DAY_MARK = {
  strong: {
    calendarCell:
      '[&_button]:font-bold [&_button]:underline [&_button]:decoration-primary [&_button]:decoration-2 [&_button]:underline-offset-4',
    legend:
      'font-bold text-foreground underline decoration-primary decoration-2 underline-offset-4',
  },
  muted: {
    calendarCell:
      '[&_button]:underline [&_button]:decoration-dotted [&_button]:underline-offset-4 [&_button]:opacity-60',
    legend: 'underline decoration-dotted underline-offset-4 opacity-60',
  },
} as const

/**
 * The day-filter state: the selected `YYYY-MM-DD` key (or `''` for "any day"),
 * its display label, and the timezone-correct way to derive a day key from a
 * slot instant.
 */
export function useDayFilter(timezone: string) {
  /** `YYYY-MM-DD` in the organizer's timezone, or `''` for "any day". */
  const [day, setDay] = useState('')

  /**
   * The calendar day an instant falls on, **as the organizer sees it**.
   *
   * The instant is an ISO string, so slicing it would group by UTC day and
   * misfile every evening session for an organizer east of Greenwich.
   */
  const dayKeyOf = (startsAtIso: string): string =>
    instantToWallClockInputs(startsAtIso, timezone).date

  /** Label for the active-day chip: "Tue, Jul 22" rather than the raw value. */
  const dayLabel = day
    ? formatDate(
        wallClockToInstant(
          {
            year: Number(day.slice(0, 4)),
            month: Number(day.slice(5, 7)),
            day: Number(day.slice(8, 10)),
            hour: 12, // Midday — never lands on a DST gap.
            minute: 0,
          },
          timezone,
        ).toISOString(),
        timezone,
      )
    : ''

  return { day, setDay, dayLabel, dayKeyOf }
}

type DayFilterChipProps = {
  dayLabel: string
  onClear: () => void
}

/** The active-day chip shown next to the other filters; ✕ clears the day. */
export function DayFilterChip({ dayLabel, onClear }: DayFilterChipProps) {
  return (
    <Badge variant="secondary" className="gap-1 py-1 pr-1 pl-2.5 h-6 text-sm text-primary">
      {dayLabel}
      <Button
        variant="ghost"
        size="icon"
        className="size-5 hover:bg-transparent"
        onClick={onClear}
        aria-label="Show every day"
      >
        <XIcon className="size-3.5" />
      </Button>
    </Badge>
  )
}

type DayFilterPickerProps = {
  /** Selected day key, `''` for "any day". */
  day: string
  /** Human label for the selected day (from {@link useDayFilter}). */
  dayLabel: string
  /** Called with the picked day key, or `''` to clear. */
  onSelect: (dayKey: string) => void
  /** Which days to mark, keyed by modifier name — the table's domain knowledge. */
  modifiers: Record<string, Date[]>
  /** Cell classes per modifier name; compose from {@link DAY_MARK}. */
  modifiersClassNames: Record<string, string>
  /** Legend row explaining the marks; sits above the clear button. */
  legend: ReactNode
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
  legend,
  defaultMonth,
  entityLabel,
}: DayFilterPickerProps) {
  const [isOpen, setOpen] = useState(false)

  const selectedDate = day ? dayKeyToDate(day) : undefined

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={day ? `Filtering by ${dayLabel}. Change day` : `Filter ${entityLabel} by day`}
        >
          <CalendarIcon data-icon="inline-start" />
          {day ? dayLabel : 'Any day'}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <Calendar
          mode="single"
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
        <div className="flex flex-col gap-2 border-t p-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {legend}
          </div>
          {day && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onSelect('')
                setOpen(false)
              }}
            >
              Show every day
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
