import Link from 'next/link'
import Image from 'next/image'
import { PlusIcon, ClockIcon, UsersIcon, PencilIcon } from 'lucide-react'
import { CabinetHeader } from '@/app/cabinet/_components/cabinet-header'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { services, getSlotsForService } from '@/lib/mock-data'

export default function ServicesPage() {
  return (
    <>
      <CabinetHeader
        crumbs={[{ label: 'Cabinet', href: '/cabinet' }, { label: 'Services' }]}
        action={
          <Button size="sm" asChild>
            <Link href="/cabinet/services/new">
              <PlusIcon data-icon="inline-start" />
              New service
            </Link>
          </Button>
        }
      />
      <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Services</h1>
          <p className="text-sm text-muted-foreground">
            Manage the experiences guests can book.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {services.map((svc) => {
            const slotCount = getSlotsForService(svc.id).length
            return (
              <Card key={svc.id} className="overflow-hidden pt-0">
                <div className="relative aspect-[16/9] w-full">
                  <Image
                    src={svc.photoUrl || '/placeholder.svg'}
                    alt={svc.title}
                    fill
                    className="object-cover"
                    sizes="(max-width: 768px) 100vw, 33vw"
                  />
                </div>
                <CardHeader>
                  <CardTitle className="text-balance">{svc.title}</CardTitle>
                  <CardDescription className="line-clamp-2">
                    {svc.description}
                  </CardDescription>
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
                      Edit
                    </Link>
                  </Button>
                </CardFooter>
              </Card>
            )
          })}
        </div>
      </div>
    </>
  )
}
