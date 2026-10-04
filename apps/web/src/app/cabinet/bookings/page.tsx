import { serviceId, uuid } from '@repo/contracts'
import { getLocale, getTranslations } from 'next-intl/server'

import { CabinetHeader } from '@/app/cabinet/_components/cabinet-header'
import { BookingsTable } from '@/app/cabinet/bookings/_components/bookings-table'
import type { BookingSort } from '@/app/cabinet/bookings/_components/use-bookings-table'
import { SORT_KEYS } from '@/app/cabinet/bookings/_components/use-bookings-table'
import { formatDateTime } from '@/helpers/date'
import { isRealDayKey } from '@/helpers/day-key'
import { getOrganizerProfile, listBookings, listServices } from '@/server/api-client'

const STATUS_VALUES = ['confirmed', 'cancelled'] as const

type BookingStatus = (typeof STATUS_VALUES)[number]

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    service?: string
    slot?: string
    page?: string
    status?: string
    q?: string
    day?: string
    sort?: string
    dir?: string
  }>
}) {
  const params = await searchParams

  // Pagination: one page of bookings at a time, 50 per page, so
  // the cabinet never loads the whole history into memory. The page number
  // lives in the URL so back/forward and deep links keep working.
  const page = Math.max(1, Number(params.page) || 1)
  const PAGE_SIZE = 50
  const offset = (page - 1) * PAGE_SIZE

  // Every filter is URL state — the API answers exactly the view the URL
  // describes, so a page of 50 rows is already filtered, not a window the
  // table narrows further. Unknown values are ignored rather than
  // forwarded as a 400.
  const status = (STATUS_VALUES as readonly string[]).includes(params.status ?? '')
    ? (params.status as BookingStatus)
    : undefined
  const sort = (SORT_KEYS as readonly string[]).includes(params.sort ?? '')
    ? (params.sort as BookingSort)
    : undefined
  const dir = params.dir === 'desc' ? 'desc' : params.dir === 'asc' ? 'asc' : undefined
  const day = params.day && isRealDayKey(params.day) ? params.day : undefined
  const q = params.q?.trim() ? params.q.trim() : undefined

  // Well-formed ids go to the API as-is: ownership is the API's job — it
  // scopes the lookups, and a foreign id resolves to an empty scoped page
  // (the chips then stay hidden). Only the slots the page actually
  // references are fetched — the bookings envelope carries them — instead
  // of the whole schedule.
  const serviceParam =
    params.service && serviceId.safeParse(params.service).success ? params.service : undefined
  const slotParam = params.slot && uuid.safeParse(params.slot).success ? params.slot : undefined

  // Translations, profile, services and the bookings page are independent
  // reads — one parallel batch, not a staircase.
  const [t, tcrumbs, locale, organizer, services, bookingsPage] = await Promise.all([
    getTranslations('Cabinet.bookings'),
    getTranslations('Cabinet.crumbs'),
    getLocale(),
    getOrganizerProfile(),
    listServices(),
    listBookings({
      limit: PAGE_SIZE,
      offset,
      serviceId: serviceParam,
      slotId: slotParam,
      status,
      q,
      day,
      sort,
      dir,
      includeDays: true,
    }),
  ])
  const { bookings, hasMore, slots, bookedDays } = bookingsPage

  // Anonymous visitors get the read-only demo profile from the API itself
  // (ADR-010) — `isDemo` is the single source of truth, not the session.
  const isReadOnly = organizer?.isDemo ?? true

  // The service chip names an owned service: an id the organizer does not
  // own is dropped from the UI rather than shown as an empty filter for
  // data they cannot see (the API already scoped it away).
  const activeServiceId =
    serviceParam && services.some((service) => service.id === serviceParam)
      ? serviceParam
      : undefined
  const activeService = services.find((service) => service.id === activeServiceId)

  const activeSlot = slotParam ? slots.find((slot) => slot.id === slotParam) : undefined
  const slotService = activeSlot
    ? services.find((service) => service.id === activeSlot.serviceId)
    : undefined

  const timezone = organizer?.timezone ?? 'UTC'

  // The slot filter is the narrower one: a slot pins one session of one
  // service. Named by service + start time — the id would mean nothing.
  const activeSlotLabel = activeSlot
    ? `${slotService ? `${slotService.title} · ` : ''}${formatDateTime(activeSlot.startsAt, timezone, locale)}`
    : undefined

  return (
    <>
      <CabinetHeader
        crumbs={[
          { label: tcrumbs('cabinet'), href: '/cabinet' },
          // Filtered? Then "Bookings" is a step back to the full list.
          ...(activeSlotLabel
            ? [
                { label: tcrumbs('bookings'), href: '/cabinet/bookings' },
                { label: activeSlotLabel },
              ]
            : activeService
              ? [
                  { label: tcrumbs('bookings'), href: '/cabinet/bookings' },
                  { label: activeService.title },
                ]
              : [{ label: tcrumbs('bookings') }]),
        ]}
      />
      <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">
            {activeSlotLabel
              ? t('reservationsFor', { label: activeSlotLabel })
              : activeService
                ? t('reservationsFor', { label: activeService.title })
                : t('subtitle')}
          </p>
        </div>
        <BookingsTable
          bookings={bookings}
          slots={slots}
          services={services}
          activeServiceId={activeServiceId}
          activeSlotLabel={activeSlotLabel}
          status={status}
          query={q}
          day={day}
          sort={sort}
          dir={dir}
          bookedDays={bookedDays}
          // Falls back to UTC only if the profile row is missing (e.g. the demo
          // seed has not run) — the table still renders rather than throwing.
          timezone={timezone}
          isReadOnly={isReadOnly}
          page={page}
          hasMore={hasMore}
        />
      </div>
    </>
  )
}
