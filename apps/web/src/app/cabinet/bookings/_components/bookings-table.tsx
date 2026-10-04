'use client'

import type { BookingRecord, ServiceRecord, TimeSlotRecord } from '@repo/contracts'
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon, SearchIcon } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { BookingDetailsSheet } from '@/app/cabinet/_components/booking-details-sheet'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { BookingRow } from './booking-row'
import { BookingsFilterBar } from './bookings-filter-bar'
import {
  type BookingSort,
  type BookingStatusFilter,
  SORT_KEYS,
  useBookingsTable,
} from './use-bookings-table'

type BookingsTableProps = {
  /** The current page of the filtered view — the API already applied every filter. */
  bookings: BookingRecord[]
  /** Slots + services let a row resolve Booking → TimeSlot → Service (docs/domain.md). */
  slots: TimeSlotRecord[]
  services: ServiceRecord[]
  /** Organizer timezone — slot instants are shown as the organizer's local time. */
  timezone: string
  /** Show only this service's bookings. Comes from `?service=` — already validated by the page. */
  activeServiceId?: string
  /** Human name for the active slot ("Service · Tue, Jul 22 · 09:00") for the chip. */
  activeSlotLabel?: string
  /** URL-derived filter state — the page parsed and validated each value. */
  status?: Exclude<BookingStatusFilter, 'all'>
  query?: string
  day?: string
  sort?: BookingSort
  dir?: 'asc' | 'desc'
  /** Scoped day keys from the API — the day picker's marks. */
  bookedDays: string[]
  /** Read-only demo account (ADR-010). */
  isReadOnly: boolean
  /** Current page (1-based) for the pagination controls. */
  page: number
  /** The API reports whether a next page exists (it fetched one row past). */
  hasMore: boolean
}

/**
 * The cabinet bookings list: a server-filtered table plus a details sheet.
 *
 * A client component because the filter controls and the sheet are
 * interactive — but every control only *navigates*: the filter state is the
 * URL and the API answers exactly the view it describes, so no filtering or
 * sorting happens here. [`useBookingsTable`](use-bookings-table.ts) holds
 * the URL plumbing.
 */
export function BookingsTable({
  bookings,
  slots,
  services,
  timezone,
  activeServiceId,
  activeSlotLabel,
  status,
  query,
  day,
  sort,
  dir,
  bookedDays,
  isReadOnly,
  page,
  hasMore,
}: BookingsTableProps) {
  const [selected, setSelected] = useState<BookingRecord | null>(null)
  const t = useTranslations('Cabinet.bookings')
  const td = useTranslations('Cabinet.dayFilter')

  const state = useBookingsTable({
    slots,
    services,
    timezone,
    activeServiceId,
    status,
    query,
    day,
    sort,
    dir,
    bookedDays,
  })

  const HEADER_LABELS: Record<BookingSort, string> = {
    guest: t('colGuest'),
    service: t('colService'),
    when: t('colWhen'),
    seats: t('colSeats'),
    status: t('colStatus'),
  }

  const sortableHead = (key: BookingSort) => {
    const sortState = state.sortState
    const active = sortState?.key === key
    return (
      <TableHead
        key={key}
        aria-sort={active ? (sortState.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 h-8"
          onClick={() => state.toggleSort(key)}
        >
          {HEADER_LABELS[key]}
          {active ? (
            sortState.dir === 'asc' ? (
              <ArrowUpIcon data-icon="inline-end" />
            ) : (
              <ArrowDownIcon data-icon="inline-end" />
            )
          ) : (
            <ChevronsUpDownIcon data-icon="inline-end" className="opacity-50" />
          )}
        </Button>
      </TableHead>
    )
  }

  const selectedService = selected ? state.serviceOf(selected) : undefined
  const selectedSlot = selected ? state.slotsById.get(selected.timeSlotId) : undefined

  // The page arrived filtered, so an empty one needs no secondary set to
  // pick a copy — the active filters decide which emptiness to explain.
  const hasNarrowingFilter = !!(status || query || day)

  return (
    <>
      <BookingsFilterBar activeSlotLabel={activeSlotLabel} state={state} />

      {bookings.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchIcon />
            </EmptyMedia>
            <EmptyTitle>{t('noBookingsFound')}</EmptyTitle>
            <EmptyDescription>
              {state.day
                ? `${t('noBookingsOnDay', { day: state.dayLabel })}${
                    state.activeService
                      ? t('forServiceSuffix', { service: state.activeService.title })
                      : ''
                  }.`
                : hasNarrowingFilter
                  ? t('tryFilters')
                  : activeSlotLabel
                    ? t('noBookingsForSlot', { label: activeSlotLabel })
                    : state.activeService
                      ? t('noBookingsForService', { service: state.activeService.title })
                      : t('bookingsAppear')}
            </EmptyDescription>
            {state.day && (
              <Button variant="outline" size="sm" onClick={() => state.setDay('')}>
                {td('showEveryDay')}
              </Button>
            )}
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>{SORT_KEYS.map(sortableHead)}</TableRow>
            </TableHeader>
            <TableBody>
              {bookings.map((booking) => (
                <BookingRow
                  key={booking.id}
                  booking={booking}
                  service={state.serviceOf(booking)}
                  slot={state.slotsById.get(booking.timeSlotId)}
                  timezone={timezone}
                  onSelect={setSelected}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <BookingDetailsSheet
        booking={selected}
        service={selectedService}
        slot={selectedSlot}
        timezone={timezone}
        isReadOnly={isReadOnly}
        onOpenChange={(open) => !open && setSelected(null)}
      />

      {/* Pagination: the page number lives in the URL so back/forward
          and deep links keep working. "Next" is enabled by the server's hasMore —
          it fetched one row past the page, so a full last page no longer links
          to an empty one. */}
      {bookings.length > 0 && (
        <div className="flex items-center justify-between">
          <PageButton href={state.pageHref(page - 1)} disabled={page <= 1}>
            {t('prevPage')}
          </PageButton>
          <span className="text-sm text-muted-foreground">{t('pageLabel', { page })}</span>
          <PageButton href={state.pageHref(page + 1)} disabled={!hasMore}>
            {t('nextPage')}
          </PageButton>
        </div>
      )}
    </>
  )
}

/**
 * Page turn as a button-looking link — `asChild` + `disabled` cannot coexist
 * (a Link swallows `disabled`), so the disabled state renders a real button.
 */
function PageButton({
  href,
  disabled,
  children,
}: {
  href: string
  disabled: boolean
  children: React.ReactNode
}) {
  if (disabled) {
    return (
      <Button variant="outline" size="sm" disabled>
        {children}
      </Button>
    )
  }
  return (
    <Button variant="outline" size="sm" asChild>
      <Link href={href}>{children}</Link>
    </Button>
  )
}
