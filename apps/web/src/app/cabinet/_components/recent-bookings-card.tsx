import type { BookingRecord, ServiceRecord, TimeSlotRecord } from '@repo/contracts'
import { ArrowRightIcon } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'

import { FilterChip } from '@/app/cabinet/_components/filter-chip'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { BookingPreviewList } from './booking-preview-list'

type RecentBookingsCardProps = {
  /** The first page of bookings — newest first, "recent activity" by definition. */
  bookings: BookingRecord[]
  /** Slots referenced by the page — embedded by the bookings endpoint. */
  slots: TimeSlotRecord[]
  services: ServiceRecord[]
  /** The `?slot=` selection — narrows the card to that session. */
  activeSlot?: TimeSlotRecord
  /** Human label for the filter chip — resolved by the page (service + time). */
  activeSlotLabel?: string
  timezone: string
  /** Read-only demo account (ADR-010). */
  isReadOnly: boolean
}

/**
 * The overview's bookings card: the newest reservations, or — when a session
 * is selected — the reservations for that session alone. The filter lives in
 * `?slot=`, which the bookings page reads too, so "View all" carries the
 * selection across instead of dropping it.
 */
export function RecentBookingsCard({
  bookings,
  slots,
  services,
  activeSlot,
  activeSlotLabel,
  timezone,
  isReadOnly,
}: RecentBookingsCardProps) {
  const t = useTranslations('Cabinet.overview')
  const tc = useTranslations('Cabinet.common')
  const td = useTranslations('Cabinet.dayFilter')

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle>{activeSlot ? t('slotBookings') : t('recentBookings')}</CardTitle>
          <CardDescription>
            {activeSlot ? t('sessionReservations') : t('latestActivity')}
          </CardDescription>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link href={activeSlot ? `/cabinet/bookings?slot=${activeSlot.id}` : '/cabinet/bookings'}>
            {tc('viewAll')}
            <ArrowRightIcon data-icon="inline-end" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {/*
          The filter is in the URL, so clearing it is a link back to the bare
          overview rather than local state — back/forward keep working. Same
          chip pattern as the bookings table.
        */}
        {activeSlotLabel && (
          <div className="pb-2">
            <FilterChip
              label={activeSlotLabel}
              clearHref="/cabinet"
              ariaLabel={td('showEveryBooking')}
            />
          </div>
        )}
        {bookings.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">
            {activeSlot ? t('noBookingsForSession') : t('bookingsAppear')}
          </p>
        ) : (
          <BookingPreviewList
            bookings={bookings}
            slots={slots}
            services={services}
            timezone={timezone}
            isReadOnly={isReadOnly}
          />
        )}
      </CardContent>
    </Card>
  )
}
