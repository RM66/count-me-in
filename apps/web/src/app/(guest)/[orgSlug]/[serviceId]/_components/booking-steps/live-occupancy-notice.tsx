'use client'

import { AlertCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import type { OccupancyNotice } from '../use-booking-dialog'

/**
 * The mid-flow availability notice (ADR-025): the picked slot filled or
 * shrank below the party while the guest was choosing. Rendered by the
 * options/details/verify steps — the slot step just disables a filled
 * row.
 *
 * - `filled` → "pick another slot" (back to step 1, clean slate).
 * - `shrunk` → "book what is left" — an explicit confirm, never a silent
 *   clamp: the guest must see the number they book.
 */
export function LiveOccupancyNotice({
  notice,
  seatsLeft = 0,
  onPickAnother,
  onConfirmSeats,
}: {
  notice: Exclude<OccupancyNotice, null>
  /** Live seats left on the picked slot — the shrink target for `shrunk`. */
  seatsLeft?: number
  onPickAnother: () => void
  /** The `shrunk` confirm — omit on steps where shrinking cannot apply. */
  onConfirmSeats?: () => void
}) {
  const t = useTranslations('Booking')

  return (
    <Alert variant="default">
      <AlertCircle />
      <AlertTitle>
        {notice === 'filled' ? t('slotFilled') : t('seatsShrunk', { count: seatsLeft })}
      </AlertTitle>
      <AlertDescription className="flex flex-wrap gap-2 pt-2">
        {/* type="button": DetailsStep renders this inside its <form>. */}
        <Button type="button" variant="outline" size="sm" onClick={onPickAnother}>
          {t('pickAnotherSlot')}
        </Button>
        {notice === 'shrunk' && onConfirmSeats && (
          <Button type="button" size="sm" onClick={onConfirmSeats}>
            {t('confirmNewSeats', { count: seatsLeft })}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  )
}
