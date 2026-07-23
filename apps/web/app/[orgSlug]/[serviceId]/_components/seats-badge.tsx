import { Badge } from '@/components/ui/badge'
import { type TimeSlot, seatsLeft, fillLabel } from '@/lib/mock-data'

export function SeatsBadge({ slot }: { slot: TimeSlot }) {
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
