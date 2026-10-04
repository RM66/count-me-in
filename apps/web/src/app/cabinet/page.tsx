import { uuid } from '@repo/contracts'
import { PlusIcon } from 'lucide-react'
import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'

import { CabinetHeader } from '@/app/cabinet/_components/cabinet-header'
import { NextSessionsCard } from '@/app/cabinet/_components/next-sessions-card'
import { OverviewStats } from '@/app/cabinet/_components/overview-stats'
import { PublicPageCard } from '@/app/cabinet/_components/public-page-card'
import { RecentBookingsCard } from '@/app/cabinet/_components/recent-bookings-card'
import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/helpers/date'
import {
  getCabinetSummary,
  getOrganizerProfile,
  listBookings,
  listServices,
  listSlots,
} from '@/server/api-client'

/** How many rows each summary card lists before deferring to its "View all" link. */
const PREVIEW_LIMIT = 5

export default async function CabinetOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ slot?: string }>
}) {
  const { slot: slotParam } = await searchParams

  // A well-formed slot id goes to the API as-is: ownership is the API's
  // job — it scopes the filter session lookup, and a foreign id simply
  // resolves to an empty scoped list.
  const filterSlotId = slotParam && uuid.safeParse(slotParam).success ? slotParam : undefined

  // The overview summarises every surface of the cabinet, so it reads what
  // the other pages read — but bounded: the profile for name / slug /
  // timezone, the service list for row-level joins, only the next few
  // upcoming slots for the preview card, the summary whose server-side
  // aggregates back the stat cards, and the bookings card's page whose
  // envelope also carries the referenced sessions (including the `?slot=`
  // filter session when owned).
  const [t, tc, tcrumbs, locale, organizer, services, nextSlotsPage, summary, bookingsPage] =
    await Promise.all([
      getTranslations('Cabinet.overview'),
      getTranslations('Cabinet.common'),
      getTranslations('Cabinet.crumbs'),
      getLocale(),
      getOrganizerProfile(),
      listServices(),
      listSlots({ upcomingOnly: true, limit: PREVIEW_LIMIT }),
      getCabinetSummary(),
      // Newest first is "recent activity" by definition; cancelled rows stay
      // in — the card shows what happened to the session, not just live seats.
      listBookings({ limit: PREVIEW_LIMIT, slotId: filterSlotId }),
    ])
  const overview = summary.overview

  // Anonymous visitors get the read-only demo profile from the API itself
  // (ADR-010) — `isDemo` is the single source of truth, not the session.
  const isReadOnly = organizer?.isDemo ?? true

  // Falls back to UTC only if the profile row is missing (e.g. the demo seed
  // has not run) — the page still renders rather than throwing.
  const timezone = organizer?.timezone ?? 'UTC'

  // Picking a slot narrows the bookings card to that session. The selection
  // lives in the URL rather than in component state, so both cards stay server
  // components and the view is shareable with a working back button — the same
  // contract the slots and bookings pages use for their filters.
  //
  // The filter session rides back inside the bookings envelope when it is
  // the viewer's — a foreign or deleted id leaves the card unlabeled.
  const activeSlot = filterSlotId
    ? bookingsPage.slots.find((slot) => slot.id === filterSlotId)
    : undefined

  // Named by service + start time, as on the bookings page — the id would mean
  // nothing to the organizer.
  const servicesById = new Map(services.map((service) => [service.id, service]))
  const activeSlotService = activeSlot ? servicesById.get(activeSlot.serviceId) : undefined
  const activeSlotLabel = activeSlot
    ? `${activeSlotService?.title ?? tc('deletedService')} · ${formatDateTime(activeSlot.startsAt, timezone, locale)}`
    : undefined

  return (
    <>
      <CabinetHeader
        crumbs={[{ label: tcrumbs('cabinet') }, { label: tcrumbs('overview') }]}
        action={
          isReadOnly ? (
            <Button size="sm" disabled>
              <PlusIcon data-icon="inline-start" />
              {t('newService')}
            </Button>
          ) : (
            <Button size="sm" asChild>
              <Link href="/cabinet/services/new">
                <PlusIcon data-icon="inline-start" />
                {t('newService')}
              </Link>
            </Button>
          )
        }
      />
      <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-balance">
            {organizer ? t('welcomeBack', { name: organizer.name }) : t('welcomeFallback')}
          </h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>

        <OverviewStats overview={overview} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <NextSessionsCard
            slots={nextSlotsPage.slots}
            services={services}
            filterSlotId={filterSlotId}
            timezone={timezone}
            locale={locale}
          />
          <RecentBookingsCard
            bookings={bookingsPage.bookings}
            slots={bookingsPage.slots}
            services={services}
            activeSlot={activeSlot}
            activeSlotLabel={activeSlotLabel}
            timezone={timezone}
            isReadOnly={isReadOnly}
          />
        </div>

        {organizer && <PublicPageCard slug={organizer.slug} />}
      </div>
    </>
  )
}
