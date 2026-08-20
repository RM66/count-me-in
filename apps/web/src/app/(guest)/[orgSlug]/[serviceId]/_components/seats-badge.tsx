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
 * row straight from Postgres.
 */
export function SeatsBadge({ slot }: { slot: SlotOccupancy }) {
  const t = useTranslations('SeatsBadge')

  const left = seatsLeft(slot)
  const status = fillLabel(slot)

  if (status === 'full') {
    return <Badge variant="secondary">{t('fullyBooked')}</Badge>
  }
  return (
    <Badge variant={status === 'filling' ? 'destructive' : 'default'}>
      {t('seatsLeft', { count: left })}
    </Badge>
  )
}
