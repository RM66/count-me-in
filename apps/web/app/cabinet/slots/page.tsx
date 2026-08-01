import { CabinetHeader } from '@/app/cabinet/_components/cabinet-header'
import { SlotsTable } from '@/app/cabinet/slots/_components/slots-table'
import { getOrganizerProfile } from '@/lib/server/db/organizer'
import { listServices } from '@/lib/server/db/service'
import { listSlots } from '@/lib/server/db/time-slot'
import { resolveCabinetOrganizerId } from '@/lib/server/demo'

export default async function SlotsPage({
  searchParams,
}: {
  searchParams: Promise<{ service?: string }>
}) {
  // Anonymous visitors get the read-only demo organizer (ADR-010).
  const { organizerId, isDemo: isReadOnly } = await resolveCabinetOrganizerId()
  const { service: serviceParam } = await searchParams

  // The profile supplies the timezone every slot instant is rendered in, and
  // the services back both the table's titles and the dialog's picker.
  //
  // Every slot is fetched, not just upcoming ones: the table splits them and
  // keeps past sessions one click away. Filtering them out here is what made a
  // mis-dated slot look like a failed save.
  const [organizer, services, slots] = await Promise.all([
    getOrganizerProfile(organizerId, isReadOnly),
    listServices(organizerId),
    listSlots(organizerId),
  ])

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

  return (
    <>
      <CabinetHeader
        crumbs={[
          { label: 'Cabinet', href: '/cabinet' },
          // Filtered by a service? Then "Slots" is a step back to the full list.
          ...(activeService
            ? [{ label: 'Slots', href: '/cabinet/slots' }, { label: activeService.title }]
            : [{ label: 'Slots' }]),
        ]}
      />
      <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Slots</h1>
          <p className="text-sm text-muted-foreground">
            {activeService
              ? `Sessions for ${activeService.title}.`
              : 'Schedule and track capacity for every session.'}
          </p>
        </div>

        <SlotsTable
          slots={slots}
          services={services}
          nowIso={nowIso}
          activeServiceId={activeServiceId}
          // Falls back to UTC only if the profile row is missing (e.g. the demo
          // seed has not run) — the table still renders rather than throwing.
          timezone={organizer?.timezone ?? 'UTC'}
          isReadOnly={isReadOnly}
        />
      </div>
    </>
  )
}
