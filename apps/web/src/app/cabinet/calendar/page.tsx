import { getTranslations } from 'next-intl/server'

import { CabinetHeader } from '@/app/cabinet/_components/cabinet-header'
import { WeekCalendar } from '@/app/cabinet/calendar/_components/week-calendar'
import { getOrganizerProfile } from '@/server/db/organizer'
import { listServices } from '@/server/db/service'
import { listSlots } from '@/server/db/time-slot'
import { resolveCabinetOrganizerId } from '@/server/demo'

/**
 * The week calendar: the same schedule the slots table lists, laid out on a
 * time grid so the organizer can see *when* sessions sit rather than reading
 * dates off rows.
 *
 * A server component that reads Postgres directly, mirroring the slots page —
 * every slot is fetched (past included) so weeks either side of "now" are not
 * blank, and the timezone comes from the profile because slots are stored as
 * instants but authored on the organizer's wall clock.
 */
export default async function CalendarPage() {
  // Anonymous visitors get the read-only demo organizer (ADR-010).
  const { organizerId, isDemo: isReadOnly } = await resolveCabinetOrganizerId()

  const tcrumbs = await getTranslations('Cabinet.crumbs')

  const [organizer, services, slots] = await Promise.all([
    getOrganizerProfile(organizerId, isReadOnly),
    listServices(organizerId),
    listSlots(organizerId),
  ])

  // "Now" as the server saw it, so the today column and the current-time line
  // cannot mismatch on hydration.
  const nowIso = new Date().toISOString()

  return (
    <>
      <CabinetHeader
        crumbs={[{ label: tcrumbs('cabinet'), href: '/cabinet' }, { label: tcrumbs('calendar') }]}
      />
      <WeekCalendar
        slots={slots}
        services={services}
        // Falls back to UTC only if the profile row is missing (e.g. the demo
        // seed has not run) — the grid still renders rather than throwing.
        timezone={organizer?.timezone ?? 'UTC'}
        nowIso={nowIso}
      />
    </>
  )
}
