'use client'

import { SearchIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { DAY_MARK, DayFilterPicker } from '@/app/cabinet/_components/day-filter'
import { FilterChip } from '@/app/cabinet/_components/filter-chip'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { useBookingsTable } from './use-bookings-table'
import { type BookingStatusFilter } from './use-bookings-table'

type BookingsFilterBarProps = {
  /** Human name for the active slot ("Service · Tue, Jul 22 · 09:00") for the chip. */
  activeSlotLabel?: string
  /** The table's URL state — the bar only navigates, it owns nothing. */
  state: ReturnType<typeof useBookingsTable>
}

/**
 * The bookings table's filter bar: status toggle, the active filter chips
 * (each a link back to the unfiltered URL — back/forward keeps working), the
 * day picker marked with days that hold bookings, and the debounced search.
 */
export function BookingsFilterBar({ activeSlotLabel, state }: BookingsFilterBarProps) {
  const t = useTranslations('Cabinet.bookings')
  const td = useTranslations('Cabinet.dayFilter')

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-3">
        <ToggleGroup
          type="single"
          value={state.filter}
          onValueChange={(v) => v && state.setFilter(v as BookingStatusFilter)}
          variant="outline"
        >
          <ToggleGroupItem value="all">{t('all')}</ToggleGroupItem>
          <ToggleGroupItem value="confirmed">{t('confirmed')}</ToggleGroupItem>
          <ToggleGroupItem value="cancelled">{t('cancelled')}</ToggleGroupItem>
        </ToggleGroup>

        {activeSlotLabel ? (
          <FilterChip
            label={activeSlotLabel}
            clearHref="/cabinet/bookings"
            ariaLabel={td('showEveryBooking')}
          />
        ) : (
          state.activeService && (
            <FilterChip
              label={state.activeService.title}
              clearHref="/cabinet/bookings"
              ariaLabel={td('showEveryService')}
            />
          )
        )}

        {state.day && (
          <FilterChip
            label={state.dayLabel}
            onClear={() => state.setDay('')}
            ariaLabel={td('showEveryDay')}
          />
        )}
      </div>

      <div className="flex items-center gap-2">
        <DayFilterPicker
          day={state.day}
          dayLabel={state.dayLabel}
          onSelect={state.setDay}
          defaultMonth={state.defaultMonth}
          entityLabel={td('entityBookings')}
          // The whole point: days whose sessions have bookings are marked.
          modifiers={{ hasBookings: state.bookedDates }}
          modifiersClassNames={{ hasBookings: DAY_MARK.strong.calendarCell }}
        />

        <div className="relative w-full sm:w-64">
          <SearchIcon className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={state.search}
            onChange={(e) => state.setSearch(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="ps-9"
          />
        </div>
      </div>
    </div>
  )
}
