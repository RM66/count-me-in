import { ClockIcon, ImageIcon, PencilIcon, PlusIcon, UsersIcon } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'

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
import { countUpcomingSlots, listServices } from '@/lib/server/db/service'
import { resolveCabinetOrganizerId } from '@/lib/server/demo'

export default async function ServicesPage() {
  // Anonymous visitors get the read-only demo organizer (ADR-010).
  const { organizerId, isDemo: isReadOnly } = await resolveCabinetOrganizerId()

  const services = await listServices(organizerId)
  const slotCounts = await countUpcomingSlots(services.map((service) => service.id))

  return (
    <>
      <CabinetHeader
        crumbs={[{ label: 'Cabinet', href: '/cabinet' }, { label: 'Services' }]}
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
          <h1 className="text-2xl font-semibold tracking-tight">Services</h1>
          <p className="text-sm text-muted-foreground">Manage the experiences guests can book.</p>
        </div>

        {services.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No services yet</CardTitle>
              <CardDescription>
                Create your first service to give guests something to book.
              </CardDescription>
            </CardHeader>
            {!isReadOnly && (
              <CardContent>
                <Button asChild>
                  <Link href="/cabinet/services/new">
                    <PlusIcon data-icon="inline-start" />
                    New service
                  </Link>
                </Button>
              </CardContent>
            )}
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {services.map((svc) => {
              const slotCount = slotCounts[svc.id] ?? 0
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
                      {svc.defaultDurationMinutes} min
                    </Badge>
                    <Badge variant="outline">
                      <UsersIcon data-icon="inline-start" />
                      {svc.defaultCapacity} seats
                    </Badge>
                  </CardContent>
                  <CardFooter className="justify-between">
                    <span className="text-sm text-muted-foreground">
                      {slotCount} upcoming {slotCount === 1 ? 'slot' : 'slots'}
                    </span>
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/cabinet/services/${svc.id}`}>
                        <PencilIcon data-icon="inline-start" />
                        {isReadOnly ? 'View' : 'Edit'}
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
