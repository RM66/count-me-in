'use client'

import type { BookingRecord, ServiceRecord, TimeSlotRecord } from '@repo/api-contracts'
import { PhoneIcon, SendIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { formatDateTime } from '@/lib/helpers/date'
import { initials } from '@/lib/helpers/name'

type BookingDetailsSheetProps = {
  /**
   * The booking to show, or `null` when nothing is selected — which is also
   * what closes the sheet. Kept as the booking rather than a boolean `open` so
   * the header can name it while the closing animation plays out.
   */
  booking: BookingRecord | null
  /**
   * The booking's service and slot, resolved by the caller: a booking reaches
   * its service transitively (Booking → TimeSlot → Service, docs/domain.md),
   * and each surface already holds the lists needed to walk that chain.
   */
  service?: ServiceRecord
  slot?: TimeSlotRecord
  /** Organizer timezone — the slot instant is shown as their local time. */
  timezone: string
  /** Read-only demo account (ADR-010): the footer actions are disabled. */
  isReadOnly: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * The booking details panel, shared by the bookings table and the cabinet
 * overview.
 *
 * Presentational and fully controlled — the selection lives in whichever list
 * opened it. That is what lets two very different rows (a table row, an avatar
 * line in a summary card) share one panel without sharing their markup.
 */
export function BookingDetailsSheet({
  booking,
  service,
  slot,
  timezone,
  isReadOnly,
  onOpenChange,
}: BookingDetailsSheetProps) {
  return (
    <Sheet open={Boolean(booking)} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col">
        <SheetHeader>
          <SheetTitle>Booking details</SheetTitle>
          <SheetDescription>Reference {booking?.id}</SheetDescription>
        </SheetHeader>
        {booking && (
          <div className="flex flex-1 flex-col gap-5 overflow-auto px-4">
            <div className="flex items-center gap-3">
              <Avatar className="size-11">
                <AvatarFallback>{initials(booking.guestName)}</AvatarFallback>
              </Avatar>
              <div className="flex flex-col">
                <span className="font-medium">{booking.guestName}</span>
                <span className="text-sm text-muted-foreground">
                  {booking.guestMessengerLogin ?? booking.guestMessengerId}
                </span>
              </div>
              <Badge
                className="ml-auto"
                variant={booking.status === 'confirmed' ? 'default' : 'secondary'}
              >
                {booking.status === 'confirmed' ? 'Confirmed' : 'Cancelled'}
              </Badge>
            </div>

            <Separator />

            <dl className="grid grid-cols-1 gap-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Service</dt>
                <dd className="text-right font-medium">{service?.title}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">When</dt>
                <dd className="text-right font-medium">
                  {slot ? formatDateTime(slot.startsAt, timezone) : '—'}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Seats</dt>
                <dd className="text-right font-medium">{booking.seats}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Messenger</dt>
                <dd className="text-right font-medium capitalize">{booking.guestMessenger}</dd>
              </div>
              {booking.selectedOptions && booking.selectedOptions.length > 0 && (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Options</dt>
                  <dd className="flex flex-wrap justify-end gap-1">
                    {booking.selectedOptions.map((o) => (
                      <Badge key={o} variant="outline">
                        {o}
                      </Badge>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        )}
        <SheetFooter>
          <Button
            disabled={isReadOnly}
            onClick={() =>
              toast.success('Reminder sent', {
                description: 'This is a mockup — no message was sent.',
              })
            }
          >
            <SendIcon data-icon="inline-start" />
            Send reminder
          </Button>
          <Button
            variant="outline"
            disabled={isReadOnly}
            onClick={() => toast('Calling guest', { description: 'This is a mockup.' })}
          >
            <PhoneIcon data-icon="inline-start" />
            Call guest
          </Button>
          {booking?.status === 'confirmed' && (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={isReadOnly}
              onClick={() => toast('Cancel booking?', { description: 'This is a mockup.' })}
            >
              <XIcon data-icon="inline-start" />
              Cancel booking
            </Button>
          )}
          <SheetClose asChild>
            <Button variant="ghost">Close</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
