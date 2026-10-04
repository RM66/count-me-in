import { wallClockToInstant } from '@repo/contracts'
import { getLocale, getTranslations } from 'next-intl/server'

import { CabinetHeader } from '@/app/cabinet/_components/cabinet-header'
import { WeekCalendar } from '@/app/cabinet/calendar/_components/week-calendar'
import { addDays, startOfWeek } from '@/app/cabinet/calendar/_components/week-layout'
import { dayKeyOfInstant, dayKeyToDate, isRealDayKey } from '@/helpers/day-key'
import { localeWeekStartsOn } from '@/helpers/week-starts-on'
import { getOrganizerProfile, listServices, listSlots } from '@/server/api-client'

/**
 * The week calendar: the same schedule the slots table lists, laid out on a
 * time grid so the organizer can see *when* sessions sit rather than reading
 * dates off rows.
 *
 * A server component that reads the schedule through the Python API. The
 * visible week is URL state (`?day=` names any day in it — back/forward and
 * deep links work like the other cabinet filters), and only that week's
 * sessions are fetched: the schedule grows with history, the window does
 * not. The timezone comes from the profile because slots are stored as
 * instants but authored on the organizer's wall clock. Anonymous visitors
 * get the read-only demo scope from the API (ADR-010).
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>
}) {
  const { day: dayParam } = await searchParams

  const [tcrumbs, locale, organizer, services] = await Promise.all([
    getTranslations('Cabinet.crumbs'),
    getLocale(),
    getOrganizerProfile(),
    listServices(),
  ])

  // "Now" as the server saw it, so the today column and the current-time line
  // cannot mismatch on hydration.
  const nowIso = new Date().toISOString()

  // Falls back to UTC only if the profile row is missing (e.g. the demo seed
  // has not run) — the grid still renders rather than throwing.
  const timezone = organizer?.timezone ?? 'UTC'

  // Any day inside the target week — validated as a real calendar date, like
  // every `?day=` filter. Absent or malformed lands on the current week.
  const day = dayParam && isRealDayKey(dayParam) ? dayParam : dayKeyOfInstant(nowIso, timezone)

  // The week containing it: the first day follows the *app* locale, so the
  // server fetch and the client grid frame the same seven days.
  const weekStartsOn = localeWeekStartsOn(locale)
  const weekStart = startOfWeek(dayKeyToDate(day), weekStartsOn)
  const weekEnd = addDays(weekStart, 7)

  const toInstant = (wall: Date) =>
    wallClockToInstant(
      {
        year: wall.getFullYear(),
        month: wall.getMonth() + 1,
        day: wall.getDate(),
        hour: 0,
        minute: 0,
      },
      timezone,
    ).toISOString()

  // `days` is the full set of session day keys — the picker's marks need
  // more than the fetched window can see.
  const { slots, days } = await listSlots({
    from: toInstant(weekStart),
    to: toInstant(weekEnd),
    includeDays: true,
  })

  return (
    <>
      <CabinetHeader
        crumbs={[{ label: tcrumbs('cabinet'), href: '/cabinet' }, { label: tcrumbs('calendar') }]}
      />
      <WeekCalendar
        slots={slots}
        slotDays={days}
        services={services}
        timezone={timezone}
        nowIso={nowIso}
        dayKey={day}
      />
    </>
  )
}
