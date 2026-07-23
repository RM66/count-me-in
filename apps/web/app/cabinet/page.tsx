import Link from 'next/link'
import {
  TicketIcon,
  UsersIcon,
  CalendarClockIcon,
  TrendingUpIcon,
  ArrowRightIcon,
  PlusIcon,
  ExternalLinkIcon,
} from 'lucide-react'
import { CabinetHeader } from '@/app/cabinet/_components/cabinet-header'
import { StatCard } from '@/app/cabinet/_components/stat-card'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import {
  bookings,
  slots,
  getService,
  getBookingService,
  seatsLeft,
  formatDateTime,
  organizer,
} from '@/lib/mock-data'

export default function CabinetOverviewPage() {
  const confirmed = bookings.filter((b) => b.status === 'confirmed')
  const totalSeats = confirmed.reduce((sum, b) => sum + b.seats, 0)
  const upcoming = [...slots]
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, 5)
  const recent = [...bookings]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5)

  return (
    <>
      <CabinetHeader
        crumbs={[{ label: 'Cabinet' }, { label: 'Overview' }]}
        action={
          <Button size="sm" asChild>
            <Link href="/cabinet/services">
              <PlusIcon data-icon="inline-start" />
              New service
            </Link>
          </Button>
        }
      />
      <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-balance">
            Welcome back, {organizer.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            Here is what is happening across your bookings.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Confirmed bookings"
            value={String(confirmed.length)}
            delta="+12%"
            hint="vs. last week"
            icon={TicketIcon}
          />
          <StatCard
            title="Seats booked"
            value={String(totalSeats)}
            delta="+8%"
            hint="across upcoming slots"
            icon={UsersIcon}
          />
          <StatCard
            title="Upcoming slots"
            value={String(slots.length)}
            hint="next 7 days"
            icon={CalendarClockIcon}
          />
          <StatCard
            title="Fill rate"
            value="74%"
            delta="+5%"
            hint="avg. seats sold"
            icon={TrendingUpIcon}
          />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
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
              {upcoming.map((slot, i) => {
                const svc = getService(slot.serviceId)
                const left = seatsLeft(slot)
                return (
                  <div key={slot.id}>
                    {i > 0 && <Separator />}
                    <div className="flex items-center justify-between gap-4 py-3">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium">{svc?.title}</span>
                        <span className="text-sm text-muted-foreground">
                          {formatDateTime(slot.startsAt)}
                        </span>
                      </div>
                      <Badge variant={left === 0 ? 'secondary' : 'outline'}>
                        {left === 0 ? 'Full' : `${left} left`}
                      </Badge>
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div className="flex flex-col gap-1">
                <CardTitle>Recent bookings</CardTitle>
                <CardDescription>Latest activity.</CardDescription>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/cabinet/bookings">
                  View all
                  <ArrowRightIcon data-icon="inline-end" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-1">
              {recent.map((b, i) => {
                const svc = getBookingService(b)
                const initials = b.guestName
                  .split(' ')
                  .map((n) => n[0])
                  .join('')
                  .slice(0, 2)
                return (
                  <div key={b.id}>
                    {i > 0 && <Separator />}
                    <div className="flex items-center gap-3 py-3">
                      <Avatar className="size-9">
                        <AvatarFallback>{initials}</AvatarFallback>
                      </Avatar>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate font-medium">{b.guestName}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {svc?.title} · {b.seats} {b.seats > 1 ? 'seats' : 'seat'}
                        </span>
                      </div>
                      {b.status === 'cancelled' && (
                        <Badge variant="outline" className="ml-auto">
                          Cancelled
                        </Badge>
                      )}
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="flex flex-col gap-1">
              <CardTitle>Your public page</CardTitle>
              <CardDescription>
                Share this link so guests can browse and book.
              </CardDescription>
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
              countmein.group/{organizer.slug}
            </code>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
