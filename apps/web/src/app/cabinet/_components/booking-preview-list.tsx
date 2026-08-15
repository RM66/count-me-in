'use client'

import type { BookingRecord, ServiceRecord, TimeSlotRecord } from '@repo/contracts'
import { useState } from 'react'

import { BookingDetailsSheet } from '@/app/cabinet/_components/booking-details-sheet'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { initials } from '@/helpers/name'

type BookingPreviewListProps = {
  bookings: BookingRecord[]
  /**
   * The slots and services the listed bookings reach — a booking names its
   * service transitively (Booking → TimeSlot → Service, docs/domain.md).
   * Only what these rows need, not the whole catalogue.
   */
  slots: TimeSlotRecord[]
  services: ServiceRecord[]
  /** Organizer timezone, for the details panel. */
  timezone: string
  /** Read-only demo account (ADR-010). */
  isReadOnly: boolean
}

/**
 * A compact, clickable list of bookings for the cabinet overview.
 *
 * A client component because a row opens the details panel, but the **data is
 * passed in** — the overview is a server component that reads Postgres
 * directly, the same split the bookings table uses. The panel itself is
 * {@link BookingDetailsSheet}, shared with that table so a booking looks the
 * same wherever it is opened from.
 */
export function BookingPreviewList({
  bookings,
  slots,
  services,
  timezone,
  isReadOnly,
}: BookingPreviewListProps) {
  const [selected, setSelected] = useState<BookingRecord | null>(null)

  const slotsById = new Map(slots.map((slot) => [slot.id, slot]))
  const servicesById = new Map(services.map((service) => [service.id, service]))

  const slotOf = (booking: BookingRecord) => slotsById.get(booking.timeSlotId)
  const serviceOf = (booking: BookingRecord) => {
    const slot = slotOf(booking)
    return slot ? servicesById.get(slot.serviceId) : undefined
  }

  return (
    <>
      {bookings.map((booking, i) => {
        const svc = serviceOf(booking)
        return (
          <div key={booking.id}>
            {i > 0 && <Separator />}
            {/*
              A button rather than a clickable div: opening a panel is an
              action, not navigation, so it must be reachable by keyboard and
              announced as such.
            */}
            <button
              type="button"
              onClick={() => setSelected(booking)}
              className="-mx-2 flex w-full items-center gap-3 rounded-md px-2 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <Avatar className="size-9">
                <AvatarFallback>{initials(booking.guestName)}</AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate font-medium">{booking.guestName}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {svc?.title ?? 'Deleted service'} · {booking.seats}{' '}
                  {booking.seats > 1 ? 'seats' : 'seat'}
                </span>
              </div>
              {booking.status === 'cancelled' && (
                <Badge variant="outline" className="ml-auto">
                  Cancelled
                </Badge>
              )}
            </button>
          </div>
        )
      })}

      <BookingDetailsSheet
        booking={selected}
        service={selected ? serviceOf(selected) : undefined}
        slot={selected ? slotOf(selected) : undefined}
        timezone={timezone}
        isReadOnly={isReadOnly}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </>
  )
}
