'use client'

import { PlusIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { DAY_MARK, DayFilterPicker } from '@/app/cabinet/_components/day-filter'
import { FilterChip } from '@/app/cabinet/_components/filter-chip'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { useSlotsTable } from './use-slots-table'

type SlotsToolbarProps = {
  /** The table's URL state — the bar only navigates, it owns nothing. */
  state: ReturnType<typeof useSlotsTable>
  /** Read-only demo account (ADR-010). */
  isReadOnly: boolean
}

/**
 * The slots table's toolbar: the upcoming/past toggle, the active filter
 * chips (each clears back to the unfiltered URL — back/forward keeps
 * working), the day picker marked with days that have sessions, and the
 * create button.
 */
export function SlotsToolbar({ state, isReadOnly }: SlotsToolbarProps) {
  const t = useTranslations('Cabinet.slots')
  const td = useTranslations('Cabinet.dayFilter')

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <ToggleGroup
          type="single"
          value={state.showPast ? 'past' : 'upcoming'}
          onValueChange={(value) => value && state.setShowPast(value === 'past')}
          variant="outline"
        >
          <ToggleGroupItem value="upcoming">
            {t('upcoming', { count: state.upcoming.length })}
          </ToggleGroupItem>
          <ToggleGroupItem value="past">{t('past', { count: state.past.length })}</ToggleGroupItem>
        </ToggleGroup>

        {state.activeService && (
          <FilterChip
            label={state.activeService.title}
            clearHref="/cabinet/slots"
            ariaLabel={td('showEveryService')}
          />
        )}

        {state.day && (
          <FilterChip
            label={state.dayLabel}
            onClear={() => state.selectDay('')}
            ariaLabel={td('showEveryDay')}
          />
        )}
      </div>

      <div className="flex items-center gap-2">
        <DayFilterPicker
          day={state.day}
          dayLabel={state.dayLabel}
          onSelect={state.selectDay}
          defaultMonth={state.defaultMonth}
          entityLabel={td('entitySlots')}
          // The whole point: days that have sessions are marked, and the
          // marking distinguishes "still to come" from "already ran".
          modifiers={{ hasUpcoming: state.upcomingDates, hasPast: state.pastDates }}
          modifiersClassNames={{
            hasUpcoming: DAY_MARK.strong.calendarCell,
            hasPast: DAY_MARK.muted.calendarCell,
          }}
        />

        <Button size="sm" disabled={isReadOnly} onClick={() => state.setDialog({ mode: 'create' })}>
          <PlusIcon data-icon="inline-start" />
          {t('addSlot')}
        </Button>
      </div>
    </div>
  )
}
