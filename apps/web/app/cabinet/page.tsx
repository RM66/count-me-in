import { seatsLeft } from '@repo/api-contracts'
import {
  ArrowRightIcon,
  CalendarClockIcon,
  ExternalLinkIcon,
  PlusIcon,
  TicketIcon,
  TrendingUpIcon,
  UsersIcon,
} from 'lucide-react'
import Link from 'next/link'

import { BookingPreviewList } from '@/app/cabinet/_components/booking-preview-list'
import { CabinetHeader } from '@/app/cabinet/_components/cabinet-header'
import { FilterChip } from '@/app/cabinet/_components/filter-chip'
import { StatCard } from '@/app/cabinet/_components/stat-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { SITE_DOMAIN } from '@/lib/constants/site'
import { formatDateTime } from '@/lib/helpers/date'
import { listBookings } from '@/lib/server/db/booking'
import { getOrganizerProfile } from '@/lib/server/db/organizer'
import { listServices } from '@/lib/server/db/service'
import { listSlots } from '@/lib/server/db/time-slot'
import { resolveCabinetOrganizerId } from '@/lib/server/demo'
import { cn } from '@/lib/utils'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** How many rows each summary card lists before deferring to its "View all" link. */
const PREVIEW_LIMIT = 5

export default async function CabinetOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ slot?: string }>
}) {
  // Anonymous visitors get the read-only demo organizer (ADR-010).
  const { organizerId, isDemo: isReadOnly } = await resolveCabinetOrganizerId()
  const { slot: slotParam } = await searchParams

  // The overview summarises every surface of the cabinet, so it reads what the
  // other pages read: the profile for name / slug / timezone, and all three
  // entities. Slots are fetched in full rather than `upcomingOnly` because a
  // recent booking may sit on a session that has already happened, and it still
  // has to resolve Booking → TimeSlot → Service to name its service.
  const [organizer, services, slots, bookings] = await Promise.all([
    getOrganizerProfile(organizerId, isReadOnly),
    listServices(organizerId),
    listSlots(organizerId),
    listBookings(organizerId),
  ])

  // Falls back to UTC only if the profile row is missing (e.g. the demo seed
  // has not run) — the page still renders rather than throwing.
  const timezone = organizer?.timezone ?? 'UTC'

  const servicesById = new Map(services.map((service) => [service.id, service]))
  const slotsById = new Map(slots.map((slot) => [slot.id, slot]))

  // One clock reading for every derived figure below: sampling `Date.now()`
  // per comparison could put a slot on both sides of "now".
  const now = Date.now()

  // `listSlots` already orders ascending, so the upcoming ones stay in
  // chronological order and the first few are literally what happens next.
  const upcoming = slots.filter((slot) => new Date(slot.startsAt).getTime() >= now)
  const upcomingThisWeek = upcoming.filter(
    (slot) => new Date(slot.startsAt).getTime() < now + WEEK_MS,
  )

  const confirmed = bookings.filter((booking) => booking.status === 'confirmed')
  const confirmedThisWeek = confirmed.filter(
    (booking) => new Date(booking.createdAt).getTime() >= now - WEEK_MS,
  )

  // Seats and fill rate both describe the *upcoming* schedule and are read off
  // `bookedCount`, the column the atomic reserve maintains (invariant 2 in
  // docs/domain.md). Summing booking seats instead would drift from it the
  // moment a cancellation released a seat.
  const seatsBooked = upcoming.reduce((sum, slot) => sum + slot.bookedCount, 0)
  const seatsOffered = upcoming.reduce((sum, slot) => sum + slot.capacity, 0)
  // No upcoming capacity means the ratio is undefined, not zero — "0%" would
  // read as an empty room rather than an empty calendar.
  const fillRate = seatsOffered === 0 ? null : Math.round((seatsBooked / seatsOffered) * 100)

  const nextSlots = upcoming.slice(0, PREVIEW_LIMIT)

  // Picking a slot narrows the bookings card to that session. The selection
  // lives in the URL rather than in component state, so both cards stay server
  // components and the view is shareable with a working back button — the same
  // contract the slots and bookings pages use for their filters.
  //
  // Resolved through the owned slots, so an id belonging to another organizer
  // simply finds nothing rather than pinning the card to a foreign session.
  const activeSlot = slotParam ? slotsById.get(slotParam) : undefined
  const activeSlotService = activeSlot ? servicesById.get(activeSlot.serviceId) : undefined

  // Named by service + start time, as on the bookings page — the id would mean
  // nothing to the organizer.
  const activeSlotLabel = activeSlot
    ? `${activeSlotService?.title ?? 'Deleted service'} · ${formatDateTime(activeSlot.startsAt, timezone)}`
    : undefined

  // `listBookings` orders newest first, which is exactly "recent activity";
  // filtering preserves that order for the selected session. Cancelled ones
  // stay in — the card shows what happened to the slot, not just live seats.
  const scopedBookings = activeSlot
    ? bookings.filter((booking) => booking.timeSlotId === activeSlot.id)
    : bookings
  const previewBookings = scopedBookings.slice(0, PREVIEW_LIMIT)

  return (
    <>
      <CabinetHeader
        crumbs={[{ label: 'Cabinet' }, { label: 'Overview' }]}
        action={
          isReadOnly ? (
            <Button size="sm" disabled>
              <PlusIcon data-icon="inline-start" />
              New service
            </Button>
          ) : (
            <Button size="sm" asChild>
              <Link href="/cabinet/services/new">
                <PlusIcon data-icon="inline-start" />
                New service
              </Link>
            </Button>
          )
        }
      />
      <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-balance">
            {organizer ? `Welcome back, ${organizer.name}` : 'Welcome back'}
          </h1>
          <p className="text-sm text-muted-foreground">
            Here is what is happening across your bookings.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            title="Confirmed bookings"
            value={String(confirmed.length)}
            hint={`${confirmedThisWeek.length} in the last 7 days`}
            icon={TicketIcon}
          />
          <StatCard
            title="Seats booked"
            value={String(seatsBooked)}
            hint="across upcoming slots"
            icon={UsersIcon}
          />
          <StatCard
            title="Upcoming slots"
            value={String(upcoming.length)}
            hint={`${upcomingThisWeek.length} in the next 7 days`}
            icon={CalendarClockIcon}
          />
          <StatCard
            title="Fill rate"
            value={fillRate === null ? '—' : `${fillRate}%`}
            hint={
              fillRate === null
                ? 'no upcoming capacity yet'
                : `${seatsBooked} of ${seatsOffered} seats taken`
            }
            icon={TrendingUpIcon}
          />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div className="flex flex-col gap-1">
                <CardTitle>Upcoming slots</CardTitle>
                <CardDescription>Your next scheduled sessions.</CardDescription>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/cabinet/slots">
                  View all
                  <ArrowRightIcon data-icon="inline-end" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-1">
              {nextSlots.length === 0 ? (
                <p className="py-3 text-sm text-muted-foreground">
                  {services.length === 0
                    ? 'Create a service, then schedule its first session.'
                    : 'Nothing scheduled yet — add a slot to open bookings.'}
                </p>
              ) : (
                nextSlots.map((slot, i) => {
                  const svc = servicesById.get(slot.serviceId)
                  const left = seatsLeft(slot)
                  const isActive = slot.id === activeSlot?.id
                  return (
                    <div key={slot.id}>
                      {i > 0 && <Separator />}
                      {/*
                        Selecting the active slot again clears the filter, so
                        the row is its own undo. `scroll={false}` keeps the
                        viewport still: the bookings card sits beside this one,
                        and jumping to the top would hide the result of the tap.
                      */}
                      <Link
                        href={isActive ? '/cabinet' : `/cabinet?slot=${slot.id}`}
                        scroll={false}
                        aria-current={isActive ? 'true' : undefined}
                        className={cn(
                          '-mx-2 flex items-center justify-between gap-4 rounded-md px-2 py-3 transition-colors',
                          'hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                          isActive && 'bg-muted hover:bg-muted',
                        )}
                      >
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium">{svc?.title ?? 'Deleted service'}</span>
                          <span className="text-sm text-muted-foreground">
                            {formatDateTime(slot.startsAt, timezone)}
                          </span>
                        </div>
                        <Badge variant={left === 0 ? 'secondary' : 'outline'}>
                          {left === 0 ? 'Full' : `${left} left`}
                        </Badge>
                      </Link>
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <div className="flex min-w-0 flex-col gap-1">
                <CardTitle>{activeSlot ? 'Slot bookings' : 'Recent bookings'}</CardTitle>
                <CardDescription>
                  {activeSlot ? 'Reservations for the selected session.' : 'Latest activity.'}
                </CardDescription>
              </div>
              {/*
                The bookings page reads the same `?slot=` parameter, so "View
                all" carries the selection across instead of dropping it.
              */}
              <Button variant="ghost" size="sm" asChild>
                <Link
                  href={
                    activeSlot ? `/cabinet/bookings?slot=${activeSlot.id}` : '/cabinet/bookings'
                  }
                >
                  View all
                  <ArrowRightIcon data-icon="inline-end" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-1">
              {/*
                The filter is in the URL, so clearing it is a link back to the
                bare overview rather than local state — back/forward keep
                working. Same chip pattern as the bookings table.
              */}
              {activeSlotLabel && (
                <div className="pb-2">
                  <FilterChip
                    label={activeSlotLabel}
                    clearHref="/cabinet"
                    ariaLabel="Show every booking"
                  />
                </div>
              )}
              {previewBookings.length === 0 ? (
                <p className="py-3 text-sm text-muted-foreground">
                  {activeSlot
                    ? 'No bookings for this session yet.'
                    : 'Bookings appear here as soon as a guest reserves a seat.'}
                </p>
              ) : (
                <BookingPreviewList
                  bookings={previewBookings}
                  slots={slots}
                  services={services}
                  timezone={timezone}
                  isReadOnly={isReadOnly}
                />
              )}
            </CardContent>
          </Card>
        </div>

        {organizer && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div className="flex flex-col gap-1">
                <CardTitle>Your public page</CardTitle>
                <CardDescription>Share this link so guests can browse and book.</CardDescription>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/${organizer.slug}`} target="_blank">
                  <ExternalLinkIcon data-icon="inline-start" />
                  Open
                </Link>
              </Button>
            </CardHeader>
            <CardContent>
              <code className="rounded-md bg-muted px-3 py-2 text-sm">
                {SITE_DOMAIN}/{organizer.slug}
              </code>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  )
}
