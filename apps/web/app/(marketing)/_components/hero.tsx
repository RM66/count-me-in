import { DEMO_CABINET_PATH, DEMO_ORGANIZER_PATH } from '@repo/api-contracts'
import { ArrowRight, CalendarCheck, LayoutDashboardIcon, TicketIcon } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export function Hero() {
  return (
    <section className="mx-auto max-w-6xl px-6 pt-16 pb-12 sm:pt-24">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <div className="flex flex-col items-start gap-6">
          <Badge variant="secondary" className="gap-1.5">
            <CalendarCheck className="size-3.5" />
            Online booking for group events
          </Badge>
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
            Fill your classes without the back-and-forth
          </h1>
          <p className="max-w-xl text-lg text-muted-foreground text-pretty">
            Publish your services with time slots and capacity. Share one link. Guests book in
            seconds — no account, no app, just their phone.
          </p>
          <Button size="lg" asChild>
            <Link href="/signup">
              Start for free
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
          <p className="text-sm text-muted-foreground">
            No credit card. Set up your first bookable service in minutes.
          </p>
          {/*
            Two read-only demo entry points (ADR-010). Kept as secondary links
            rather than buttons next to "Start for free": three side-by-side CTAs
            read as a choice, not a call to action. Labels name *whose* view it
            is — "See a live example" left that ambiguous.
          */}
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Prefer to look around first?</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Link
                href={DEMO_ORGANIZER_PATH}
                className="inline-flex items-center gap-1.5 text-sm font-medium underline underline-offset-4 decoration-[rgba(127,127,127,0.33)] hover:text-muted-foreground"
              >
                <TicketIcon className="size-4" />
                See a guest booking page
              </Link>
              <Link
                href={DEMO_CABINET_PATH}
                className="inline-flex items-center gap-1.5 text-sm font-medium underline underline-offset-4 decoration-[rgba(127,127,127,0.33)] hover:text-muted-foreground"
              >
                <LayoutDashboardIcon className="size-4" />
                See the organizer cabinet
              </Link>
            </div>
          </div>
        </div>

        <div className="relative">
          <div className="overflow-hidden rounded-2xl border shadow-sm">
            <Image
              src="/service-yoga.png"
              alt="A morning yoga class in a bright studio"
              width={720}
              height={560}
              className="aspect-4/3 w-full object-cover"
              priority
            />
          </div>
          <div className="absolute -bottom-5 -left-5 hidden rounded-xl border bg-card p-4 shadow-md sm:block">
            <p className="text-sm font-medium">Morning Vinyasa Flow</p>
            <p className="text-sm text-muted-foreground">Tomorrow · 07:00 · 3 seats left</p>
          </div>
        </div>
      </div>
    </section>
  )
}
