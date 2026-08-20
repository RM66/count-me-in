import { ClockIcon, ImageIcon, PencilIcon, PlusIcon, UsersIcon } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

import { CabinetHeader } from '@/app/cabinet/_components/cabinet-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { countConfirmedBookings } from '@/server/db/booking'
import { countUpcomingSlots, listServices } from '@/server/db/service'
import { resolveCabinetOrganizerId } from '@/server/demo'

export default async function ServicesPage() {
  // Anonymous visitors get the read-only demo organizer (ADR-010).
  const { organizerId, isDemo: isReadOnly } = await resolveCabinetOrganizerId()

  const t = await getTranslations('Cabinet.services')
  const tc = await getTranslations('Cabinet.common')
  const tcrumbs = await getTranslations('Cabinet.crumbs')
  const tslots = await getTranslations('Cabinet.slots')

  const services = await listServices(organizerId)
  const serviceIds = services.map((service) => service.id)
  const [slotCounts, bookingCounts] = await Promise.all([
    countUpcomingSlots(serviceIds),
    countConfirmedBookings(serviceIds),
  ])

  return (
    <>
      <CabinetHeader
        crumbs={[{ label: tcrumbs('cabinet'), href: '/cabinet' }, { label: tcrumbs('services') }]}
        action={
          isReadOnly ? (
            <Button size="sm" disabled>
              <PlusIcon data-icon="inline-start" />
              {t('newService')}
            </Button>
          ) : (
            <Button size="sm" asChild>
              <Link href="/cabinet/services/new">
                <PlusIcon data-icon="inline-start" />
                {t('newService')}
              </Link>
            </Button>
          )
        }
      />
      <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>

        {services.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('noServicesYet')}</CardTitle>
              <CardDescription>{t('noServicesDescription')}</CardDescription>
            </CardHeader>
            {!isReadOnly && (
              <CardContent>
                <Button asChild>
                  <Link href="/cabinet/services/new">
                    <PlusIcon data-icon="inline-start" />
                    {t('newService')}
                  </Link>
                </Button>
              </CardContent>
            )}
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {services.map((svc) => {
              const slotCount = slotCounts[svc.id] ?? 0
              const bookingCount = bookingCounts[svc.id] ?? 0
              return (
                <Card key={svc.id} className="overflow-hidden pt-0">
                  <div className="relative aspect-video w-full">
                    {svc.photoUrl ? (
                      <Image
                        src={svc.photoUrl}
                        alt={svc.title}
                        fill
                        className="object-cover"
                        sizes="(max-width: 768px) 100vw, 33vw"
                      />
                    ) : (
                      <div className="flex size-full items-center justify-center bg-muted">
                        <ImageIcon className="size-8 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <CardHeader>
                    <CardTitle className="text-balance">{svc.title}</CardTitle>
                    <CardDescription className="line-clamp-2">{svc.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{svc.defaultPrice}</Badge>
                    <Badge variant="outline">
                      <ClockIcon data-icon="inline-start" />
                      {tc('min', { minutes: svc.defaultDurationMinutes })}
                    </Badge>
                    <Badge variant="outline">
                      <UsersIcon data-icon="inline-start" />
                      {tc('seats', { count: svc.defaultCapacity })}
                    </Badge>
                  </CardContent>
                  <CardFooter className="justify-between">
                    {/*
                      Links into the slots / bookings pages filtered by this
                      service. Kept plain links rather than buttons: they are
                      navigation, and the filter lives in the URL so it stays
                      shareable.
                    */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <Link
                        href={`/cabinet/slots?service=${svc.id}`}
                        className="rounded-sm text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                      >
                        {tslots('upcomingCount', { count: slotCount })}
                      </Link>
                      <Link
                        href={`/cabinet/bookings?service=${svc.id}`}
                        className="rounded-sm text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                      >
                        {t('countBookings', { count: bookingCount })}
                      </Link>
                    </div>
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/cabinet/services/${svc.id}`}>
                        <PencilIcon data-icon="inline-start" />
                        {isReadOnly ? tc('view') : tc('edit')}
                      </Link>
                    </Button>
                  </CardFooter>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
