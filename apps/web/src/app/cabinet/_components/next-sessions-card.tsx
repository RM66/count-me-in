import type { ServiceRecord, TimeSlotRecord } from '@repo/contracts'
import { seatsLeft } from '@repo/contracts'
import { ArrowRightIcon } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { formatDateTime } from '@/helpers/date'
import { cn } from '@/lib/utils'

type NextSessionsCardProps = {
  /** The next few upcoming sessions — the page bounds the fetch. */
  slots: TimeSlotRecord[]
  services: ServiceRecord[]
  /** The `?slot=` selection — the matching row becomes its own undo. */
  filterSlotId?: string
  timezone: string
  locale: string
}

/**
 * The overview's "next sessions" card: the first rows of the upcoming
 * schedule. Each row links back to `/cabinet?slot=` — selecting a row narrows
 * the neighbouring bookings card to that session, and tapping the selected row
 * clears the filter (the selection lives in the URL, so the card stays a
 * server component and the view is shareable with a working back button).
 */
export function NextSessionsCard({
  slots,
  services,
  filterSlotId,
  timezone,
  locale,
}: NextSessionsCardProps) {
  const t = useTranslations('Cabinet.overview')
  const tc = useTranslations('Cabinet.common')
  const servicesById = new Map(services.map((service) => [service.id, service]))

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex flex-col gap-1">
          <CardTitle>{t('upcomingSlots')}</CardTitle>
          <CardDescription>{t('nextSessions')}</CardDescription>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/cabinet/slots">
            {tc('viewAll')}
            <ArrowRightIcon data-icon="inline-end" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {slots.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">
            {services.length === 0 ? t('createServiceFirst') : t('nothingScheduled')}
          </p>
        ) : (
          slots.map((slot, i) => {
            const svc = servicesById.get(slot.serviceId)
            const left = seatsLeft(slot)
            const isActive = slot.id === filterSlotId
            return (
              <div key={slot.id}>
                {i > 0 && <Separator />}
                {/*
                  Selecting the active slot again clears the filter, so the row
                  is its own undo. `scroll={false}` keeps the viewport still:
                  the bookings card sits beside this one, and jumping to the
                  top would hide the result of the tap.
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
                    <span className="font-medium">{svc?.title ?? tc('deletedService')}</span>
                    <span className="text-sm text-muted-foreground">
                      {formatDateTime(slot.startsAt, timezone, locale)}
                    </span>
                  </div>
                  <Badge variant={left === 0 ? 'secondary' : 'outline'}>
                    {left === 0 ? tc('full') : tc('left', { count: left })}
                  </Badge>
                </Link>
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}
