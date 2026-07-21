import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { GuestShell } from '@/components/guest/guest-shell'
import { BookingDialog } from '@/components/guest/booking-dialog'
import { SeatsBadge } from '@/components/guest/seats-badge'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { ArrowLeft, Clock, Users, Tag, CalendarX } from 'lucide-react'
import {
  organizer,
  getService,
  getSlotsForService,
  seatsLeft,
  slotPrice,
  formatDate,
  formatTime,
} from '@/lib/mock-data'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ serviceId: string }>
}): Promise<Metadata> {
  const { serviceId } = await params
  const service = getService(serviceId)
  return {
    title: service ? `${service.title} — ${organizer.name}` : 'Service',
    description: service?.description,
  }
}

export default async function ServicePage({
  params,
}: {
  params: Promise<{ orgSlug: string; serviceId: string }>
}) {
  const { orgSlug, serviceId } = await params
  if (orgSlug !== organizer.slug) notFound()

  const service = getService(serviceId)
  if (!service) notFound()

  const slots = getSlotsForService(serviceId)
  const hasOpen = slots.some((s) => seatsLeft(s) > 0)

  return (
    <GuestShell>
      <div className="flex flex-col gap-5">
        <Link
          href={`/${orgSlug}`}
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
            className="aspect-[2/1] w-full object-cover"
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
          </div>
          <p className="leading-relaxed text-muted-foreground text-pretty">{service.description}</p>
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
                <EmptyDescription>Check back soon — new times are added regularly.</EmptyDescription>
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
                        {formatDate(slot.startsAt)} · {formatTime(slot.startsAt)}
                      </span>
                      <span className="text-xs text-muted-foreground">{slotPrice(slot)}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <SeatsBadge slot={slot} />
                      <BookingDialog
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
    </GuestShell>
  )
}
