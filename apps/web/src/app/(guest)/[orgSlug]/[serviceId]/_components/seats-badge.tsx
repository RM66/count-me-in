import type { SlotOccupancy } from '@repo/contracts'
import { fillLabel, seatsLeft } from '@repo/contracts'

import { Badge } from '@/components/ui/badge'

/**
 * Availability badge for one slot.
 *
 * Takes `SlotOccupancy` rather than a full slot record: capacity and
 * `bookedCount` are all it reads, so it renders equally well for a slot DTO or a
 * row straight from Postgres.
 */
export function SeatsBadge({ slot }: { slot: SlotOccupancy }) {
  const left = seatsLeft(slot)
  const status = fillLabel(slot)

  if (status === 'full') {
    return <Badge variant="secondary">Fully booked</Badge>
  }
  return (
    <Badge variant={status === 'filling' ? 'destructive' : 'default'}>
      {left} {left === 1 ? 'seat' : 'seats'} left
    </Badge>
  )
}
