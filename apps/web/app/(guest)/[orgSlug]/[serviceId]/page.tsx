import { effectiveContact, effectiveLocation, seatsLeft, slotPrice } from '@repo/api-contracts'
import { ArrowLeft, CalendarX, Clock, MapPin, Tag, Users } from 'lucide-react'
import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { BookingDialog } from '@/app/(guest)/[orgSlug]/[serviceId]/_components/booking-dialog'
import { SeatsBadge } from '@/app/(guest)/[orgSlug]/[serviceId]/_components/seats-badge'
import { ContactLink } from '@/components/contact-link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Separator } from '@/components/ui/separator'
import { formatDate, formatTime } from '@/lib/helpers/date'
import { getPublicOrganizerBySlug } from '@/lib/server/db/organizer'
import { getPublicService } from '@/lib/server/db/service'
import { listUpcomingSlotsForServices } from '@/lib/server/db/time-slot'

/**
 * Resolve the `/{orgSlug}/{serviceId}` pair into an organizer and their service.
 *
 * Shared by the page and its metadata because both need the same two rows and
 * the same `404` rule: the service must belong to the organizer in the URL, or
 * one organizer's service would render under another's name.
 */
async function resolveService(orgSlug: string, serviceId: string) {
  const organizer = await getPublicOrganizerBySlug(orgSlug)
  if (!organizer) return null

  const service = await getPublicService(organizer.id, serviceId)
  if (!service) return null

  return { organizer, service }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ orgSlug: string; serviceId: string }>
}): Promise<Metadata> {
  const { orgSlug, serviceId } = await params
  const resolved = await resolveService(orgSlug, serviceId)

  if (!resolved) return { title: 'Service not found' }

  return {
    title: `${resolved.service.title} — ${resolved.organizer.name}`,
    description: resolved.service.description ?? undefined,
  }
}

export default async function ServicePage({
  params,
}: {
  params: Promise<{ orgSlug: string; serviceId: string }>
}) {
  const { orgSlug, serviceId } = await params

  const resolved = await resolveService(orgSlug, serviceId)
  if (!resolved) notFound()
  const { organizer, service } = resolved

  const slots = await listUpcomingSlotsForServices([service.id])

  const hasOpen = slots.some((slot) => seatsLeft(slot) > 0)

  // A service may override its organizer's location and contact; the fallback
  // rule lives in api-contracts because the worker and calendar links need it
  // too (docs/domain.md).
  const location = effectiveLocation(service, organizer)
  const contact = effectiveContact(service, organizer)

  return (
    <>
      <div className="flex flex-col gap-5">
        <Link
          href={`/${organizer.slug}`}
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {organizer.name}
        </Link>

        <div className="overflow-hidden rounded-xl border">
          <Image
            src={service.photoUrl || '/placeholder.svg'}
            alt={service.title}
            width={720}
            height={360}
            className="aspect-2/1 w-full object-cover"
            priority
          />
        </div>

        <div className="flex flex-col gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-balance">{service.title}</h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Clock className="size-4" />
              {service.defaultDurationMinutes} min
            </span>
            <span className="flex items-center gap-1.5">
              <Users className="size-4" />
              up to {service.defaultCapacity} seats
            </span>
            <span className="flex items-center gap-1.5 font-medium text-foreground">
              <Tag className="size-4" />
              {service.defaultPrice}
            </span>
            {location ? (
              <span className="flex items-center gap-1.5">
                <MapPin className="size-4" />
                {location}
              </span>
            ) : null}
            {contact ? <ContactLink contact={contact} className="hover:text-foreground" /> : null}
          </div>
          {service.description ? (
            <p className="leading-relaxed text-muted-foreground text-pretty">
              {service.description}
            </p>
          ) : null}
          {service.options?.length ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {service.optionsSelectMode === 'single' ? 'Choose one:' : 'Add-ons:'}
              </span>
              {service.options.map((opt) => (
                <Badge key={opt} variant="outline" className="font-normal">
                  {opt}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>

        <Separator />

        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Upcoming slots</h2>

          {slots.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <CalendarX className="size-6 text-muted-foreground" />
                <EmptyTitle>No slots yet</EmptyTitle>
                <EmptyDescription>
                  Check back soon — new times are added regularly.
                </EmptyDescription>
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
                        {formatDate(slot.startsAt, organizer.timezone)} ·{' '}
                        {formatTime(slot.startsAt, organizer.timezone)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {slotPrice(slot, service)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <SeatsBadge slot={slot} />
                      <BookingDialog
                        organizer={organizer}
                        service={service}
                        slots={slots}
                        preselectedSlotId={slot.id}
                        trigger={
                          <Button size="sm" disabled={full}>
                            {full ? 'Full' : 'Book'}
                          </Button>
                        }
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="sticky bottom-4 mt-6">
        <div className="rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur">
          <BookingDialog
            organizer={organizer}
            service={service}
            slots={slots}
            trigger={
              <Button className="w-full" size="lg" disabled={!hasOpen}>
                {hasOpen ? 'Book now' : 'Fully booked'}
              </Button>
            }
          />
        </div>
      </div>
    </>
  )
}
