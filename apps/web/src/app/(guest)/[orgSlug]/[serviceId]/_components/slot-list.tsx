'use client'

import { seatsLeft, slotPrice } from '@repo/contracts'
import { CalendarX } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { formatDate, formatTime } from '@/helpers/date'
import { BookButton } from './book-button'
import { useBookingFlow } from './booking-flow'
import { SeatsBadge } from './seats-badge'

/**
 * The upcoming-slots list, its empty state and the sticky footer — all
 * client-rendered from the live query inside [`BookingFlow`]
 * (booking-flow.tsx), so an SSE invalidation or a reconcile refetch
 * re-renders the badges, the "full" state and the 0↔1 empty transition
 * without a reload. SSR of this client component still emits the rows
 * into the HTML — first paint and crawlers lose nothing (ADR-025).
 */
export function SlotList() {
  const t = useTranslations('ServicePage')
  const locale = useLocale()
  const { organizer, service, slots } = useBookingFlow()

  const hasOpen = slots.some((slot) => seatsLeft(slot) > 0)

  return (
    <>
      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">{t('upcomingSlots')}</h2>

        {slots.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <CalendarX className="size-6 text-muted-foreground" />
              <EmptyTitle>{t('noSlotsYet')}</EmptyTitle>
              <EmptyDescription>{t('checkBackSoon')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col gap-2">
            {slots.map((slot) => {
              const full = seatsLeft(slot) === 0
              return (
                <div
                  key={slot.id}
                  className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3"
                >
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">
                      {formatDate(slot.startsAt, organizer.timezone, locale)} ·{' '}
                      {formatTime(slot.startsAt, organizer.timezone, locale)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {slotPrice(slot, service)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <SeatsBadge slot={slot} />
                    <BookButton slotId={slot.id} size="sm" disabled={full}>
                      {full ? t('full') : t('book')}
                    </BookButton>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="sticky bottom-4 mt-6">
        <div className="rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur">
          <BookButton size="lg" className="w-full" disabled={!hasOpen}>
            {hasOpen ? t('bookNow') : t('fullyBooked')}
          </BookButton>
        </div>
      </div>
    </>
  )
}
