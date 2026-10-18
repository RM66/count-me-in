'use client'

import type { SlotOccupancy } from '@repo/contracts'
import { fillLabel, seatsLeft } from '@repo/contracts'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'

/**
 * Availability badge for one slot.
 *
 * Takes `SlotOccupancy` rather than a full slot record: capacity and
 * `bookedCount` are all it reads, so it renders equally well for a slot DTO or a
 * nested occupancy summary.
 *
 * `aria-live="polite"`: the badge re-renders on SSE occupancy patches
 * (ADR-025), and a screen reader should hear the new count.
 */
export function SeatsBadge({ slot }: { slot: SlotOccupancy }) {
  const t = useTranslations('SeatsBadge')

  const left = seatsLeft(slot)
  const status = fillLabel(slot)

  // The live region must stay mounted — an unmount/remount drops the
  // observed element and a status flip goes unannounced.
  return (
    <span aria-live="polite">
      {status === 'full' ? (
        <Badge variant="secondary">{t('fullyBooked')}</Badge>
      ) : (
        <Badge variant={status === 'filling' ? 'destructive' : 'default'}>
          {t('seatsLeft', { count: left })}
        </Badge>
      )}
    </span>
  )
}
