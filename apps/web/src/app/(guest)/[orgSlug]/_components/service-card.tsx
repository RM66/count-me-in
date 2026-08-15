import type { ServiceRecord, TimeSlotRecord } from '@repo/contracts'
import { seatsLeft } from '@repo/contracts'
import { ChevronRight } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'

import { ServiceMetaBadges } from '@/app/(guest)/_components/service-meta-badges'
import { Badge } from '@/components/ui/badge'
import { formatDate, formatTime } from '@/helpers/date'

/**
 * One service on the public organizer page.
 *
 * Slots are passed in rather than fetched here: the page reads every service's
 * upcoming slots in one query, and a card that queried for itself would turn the
 * list into an N+1. `timezone` comes from the organizer for the same reason it
 * does everywhere else — an instant means nothing until it is rendered in their
 * zone (docs/domain.md).
 */
export function ServiceCard({
  orgSlug,
  service,
  slots,
  timezone,
}: {
  orgSlug: string
  service: ServiceRecord
  /** This service's upcoming slots, already ordered earliest first. */
  slots: TimeSlotRecord[]
  timezone: string
}) {
  // Already sorted by the query, so the first with a free seat is the soonest
  // one a guest can actually take.
  const nextOpen = slots.find((slot) => seatsLeft(slot) > 0)

  return (
    <Link
      href={`/${orgSlug}/${service.id}`}
      className="group flex gap-4 rounded-xl border bg-card p-3 transition-colors hover:border-primary/40 hover:bg-accent/40"
    >
      <Image
        src={service.photoUrl || '/placeholder.svg'}
        alt=""
        width={112}
        height={112}
        className="size-24 shrink-0 rounded-lg object-cover sm:size-28"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-medium leading-tight text-balance">{service.title}</h3>
          <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </div>
        {service.description ? (
          <p className="line-clamp-2 text-sm text-muted-foreground text-pretty">
            {service.description}
          </p>
        ) : null}
        <div className="mt-auto pt-1">
          <ServiceMetaBadges service={service} />
        </div>
        {nextOpen ? (
          <Badge variant="secondary" className="mt-1 w-fit font-normal">
            Next: {formatDate(nextOpen.startsAt, timezone)} ·{' '}
            {formatTime(nextOpen.startsAt, timezone)}
          </Badge>
        ) : (
          <Badge variant="outline" className="mt-1 w-fit font-normal">
            No open slots
          </Badge>
        )}
      </div>
    </Link>
  )
}
