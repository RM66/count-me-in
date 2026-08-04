'use client'

import type { PublicOrganizer, ServiceRecord, TimeSlotRecord } from '@repo/api-contracts'
import { seatsLeft, slotPrice } from '@repo/api-contracts'

import { SeatsBadge } from '@/app/(guest)/[orgSlug]/[serviceId]/_components/seats-badge'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { formatDate, formatTime } from '@/lib/helpers/date'
import { cn } from '@/lib/utils'

/**
 * Step 1: pick a time slot.
 *
 * The radio list shows every upcoming session with its date, price and seats
 * left. A full slot is visible but disabled — the guest can see it exists, they
 * just cannot pick it.
 */
export function SlotStep({
  slots,
  organizer,
  service,
  slotId,
  onSlotChange,
  onContinue,
}: {
  slots: TimeSlotRecord[]
  organizer: PublicOrganizer
  service: ServiceRecord
  slotId?: string
  onSlotChange: (id: string) => void
  onContinue: () => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <RadioGroup value={slotId} onValueChange={onSlotChange} className="gap-2">
        {slots.map((s) => {
          const full = seatsLeft(s) === 0
          return (
            <label
              key={s.id}
              htmlFor={`slot-${s.id}`}
              className={cn(
                'flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3 transition-colors',
                slotId === s.id && 'border-primary bg-accent',
                full && 'cursor-not-allowed opacity-60',
              )}
            >
              <div className="flex items-center gap-3">
                <RadioGroupItem id={`slot-${s.id}`} value={s.id} disabled={full} />
                <div className="flex flex-col">
                  <span className="text-sm font-medium">
                    {formatDate(s.startsAt, organizer.timezone)} ·{' '}
                    {formatTime(s.startsAt, organizer.timezone)}
                  </span>
                  <span className="text-xs text-muted-foreground">{slotPrice(s, service)}</span>
                </div>
              </div>
              <SeatsBadge slot={s} />
            </label>
          )
        })}
      </RadioGroup>
      <Button disabled={!slotId} onClick={onContinue}>
        Continue
      </Button>
    </div>
  )
}
