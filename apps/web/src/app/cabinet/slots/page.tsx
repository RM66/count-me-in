import { getTranslations } from 'next-intl/server'

import { CabinetHeader } from '@/app/cabinet/_components/cabinet-header'
import { SlotsTable } from '@/app/cabinet/slots/_components/slots-table'
import { isRealDayKey } from '@/helpers/day-key'
import { getOrganizerProfile, listServices, listSlots } from '@/server/api-client'

export default async function SlotsPage({
  searchParams,
}: {
  searchParams: Promise<{ service?: string; day?: string; past?: string }>
}) {
  const { service: serviceParam, day: dayParam, past: pastParam } = await searchParams

  // The profile supplies the timezone every slot instant is rendered in, and
  // the services back both the table's titles and the dialog's picker.
  //
  // Every slot is fetched, not just upcoming ones: the table splits them and
  // keeps past sessions one click away. Filtering them out here is what made a
  // mis-dated slot look like a failed save.
  const [t, tcrumbs, organizer, services, slotsPage] = await Promise.all([
    getTranslations('Cabinet.slots'),
    getTranslations('Cabinet.crumbs'),
    getOrganizerProfile(),
    listServices(),
    listSlots(),
  ])
  const slots = slotsPage.slots

  // Anonymous visitors get the read-only demo profile from the API itself
  // (ADR-010) — `isDemo` is the single source of truth, not the session.
  const isReadOnly = organizer?.isDemo ?? true

  // Sent from the server so the client's split matches what was rendered —
  // deriving "now" during render would risk a hydration mismatch.
  const nowIso = new Date().toISOString()

  // The filter lives in the URL so the services list can deep-link into it and
  // the browser's back button works. An id the organizer does not own is
  // ignored rather than shown as an empty filter for a service they cannot see.
  const activeServiceId =
    serviceParam && services.some((service) => service.id === serviceParam)
      ? serviceParam
      : undefined
  const activeService = services.find((service) => service.id === activeServiceId)

  // Day and the upcoming/past toggle share the same URL contract as the
  // service filter — a picked day is validated as a real calendar date
  // before the table sees it, and `?past=1` is the only truthy spelling.
  const day = dayParam && isRealDayKey(dayParam) ? dayParam : undefined
  const showPast = pastParam === '1'

  return (
    <>
      <CabinetHeader
        crumbs={[
          { label: tcrumbs('cabinet'), href: '/cabinet' },
          // Filtered by a service? Then "Slots" is a step back to the full list.
          ...(activeService
            ? [{ label: tcrumbs('slots'), href: '/cabinet/slots' }, { label: activeService.title }]
            : [{ label: tcrumbs('slots') }]),
        ]}
      />
      <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">
            {activeService ? t('sessionsFor', { service: activeService.title }) : t('subtitle')}
          </p>
        </div>

        <SlotsTable
          slots={slots}
          services={services}
          nowIso={nowIso}
          activeServiceId={activeServiceId}
          day={day}
          showPast={showPast}
          // Falls back to UTC only if the profile row is missing (e.g. the demo
          // seed has not run) — the table still renders rather than throwing.
          timezone={organizer?.timezone ?? 'UTC'}
          isReadOnly={isReadOnly}
        />
      </div>
    </>
  )
}
