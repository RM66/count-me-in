import { ArrowRight, CalendarCheck } from 'lucide-react'
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
          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg" asChild>
              <Link href="/signup">
                Start for free
                <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/studio-lumen">See a live example</Link>
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            No credit card. Set up your first bookable service in minutes.
          </p>
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
