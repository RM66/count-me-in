import { getLocale, getTranslations } from 'next-intl/server'

import { CabinetHeader } from '@/app/cabinet/_components/cabinet-header'
import { BookingsTable } from '@/app/cabinet/bookings/_components/bookings-table'
import { formatDateTime } from '@/helpers/date'
import { listBookings } from '@/server/db/booking'
import { getOrganizerProfile } from '@/server/db/organizer'
import { listServices } from '@/server/db/service'
import { listSlots } from '@/server/db/time-slot'
import { resolveCabinetOrganizerId } from '@/server/demo'

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ service?: string; slot?: string }>
}) {
  // Anonymous visitors get the read-only demo organizer (ADR-010).
  const { organizerId, isDemo: isReadOnly } = await resolveCabinetOrganizerId()
  const { service: serviceParam, slot: slotParam } = await searchParams

  const t = await getTranslations('Cabinet.bookings')
  const tcrumbs = await getTranslations('Cabinet.crumbs')
  const locale = await getLocale()

  // A booking reaches its service transitively (Booking → TimeSlot → Service),
  // so the table needs all three lists to render a row; the profile supplies
  // the timezone every slot instant is shown in. Bookings on past slots are
  // history, not noise — nothing is filtered out here.
  const [organizer, services, slots, bookings] = await Promise.all([
    getOrganizerProfile(organizerId, isReadOnly),
    listServices(organizerId),
    listSlots(organizerId),
    listBookings(organizerId),
  ])

  // The filters live in the URL so the services and slots pages can deep-link
  // into them and the browser's back button works — the same contract as the
  // slots page. An id the organizer does not own is ignored rather than shown
  // as an empty filter for data they cannot see.
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
          activeSlotId={activeSlot?.id}
          activeSlotLabel={activeSlotLabel}
          // Falls back to UTC only if the profile row is missing (e.g. the demo
          // seed has not run) — the table still renders rather than throwing.
          timezone={timezone}
          isReadOnly={isReadOnly}
        />
      </div>
    </>
  )
}
