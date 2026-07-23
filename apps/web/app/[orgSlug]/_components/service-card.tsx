import Link from 'next/link'
import Image from 'next/image'
import { Badge } from '@/components/ui/badge'
import { Clock, Users, ChevronRight } from 'lucide-react'
import {
  type Service,
  getSlotsForService,
  seatsLeft,
  formatDate,
  formatTime,
} from '@/lib/mock-data'

export function ServiceCard({ orgSlug, service }: { orgSlug: string; service: Service }) {
  const slots = getSlotsForService(service.id)
  const nextOpen = slots.find((s) => seatsLeft(s) > 0)

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
        <p className="line-clamp-2 text-sm text-muted-foreground text-pretty">
          {service.description}
        </p>
        <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="size-3.5" />
            {service.defaultDurationMinutes} min
          </span>
          <span className="flex items-center gap-1">
            <Users className="size-3.5" />
            up to {service.defaultCapacity}
          </span>
          <span className="font-medium text-foreground">{service.defaultPrice}</span>
        </div>
        {nextOpen ? (
          <Badge variant="secondary" className="mt-1 w-fit font-normal">
            Next: {formatDate(nextOpen.startsAt)} · {formatTime(nextOpen.startsAt)}
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
