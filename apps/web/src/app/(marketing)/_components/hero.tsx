import { DEMO_CABINET_PATH, DEMO_ORGANIZER_PATH } from '@repo/contracts'
import { ArrowRight, CalendarCheck, LayoutDashboardIcon, TicketIcon } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

import { HeroCarousel } from '@/app/(marketing)/_components/hero-carousel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export async function Hero() {
  const t = await getTranslations('Marketing.hero')

  return (
    <section className="mx-auto max-w-6xl px-6 pt-16 pb-12 sm:pt-24">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <div className="flex flex-col items-start gap-6">
          <Badge variant="secondary" className="gap-1.5">
            <CalendarCheck className="size-3.5" />
            {t('badge')}
          </Badge>
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            {t('title')}
          </h1>
          <p className="max-w-xl text-lg text-muted-foreground text-pretty">{t('subtitle')}</p>
          <Button size="lg" asChild>
            <Link href="/signup">
              {t('startFree')}
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
          <p className="text-sm text-muted-foreground">{t('noCreditCard')}</p>
          {/*
            Two read-only demo entry points (ADR-010). Kept as secondary links
            rather than buttons next to "Start for free": three side-by-side CTAs
            read as a choice, not a call to action. Labels name *whose* view it
            is — "See a live example" left that ambiguous.
          */}
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">{t('lookAround')}</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Link
                href={DEMO_ORGANIZER_PATH}
                className="inline-flex items-center gap-1.5 text-sm font-medium underline underline-offset-4 decoration-[rgba(127,127,127,0.33)] hover:text-muted-foreground"
              >
                <TicketIcon className="size-4" />
                {t('guestPage')}
              </Link>
              <Link
                href={DEMO_CABINET_PATH}
                className="inline-flex items-center gap-1.5 text-sm font-medium underline underline-offset-4 decoration-[rgba(127,127,127,0.33)] hover:text-muted-foreground"
              >
                <LayoutDashboardIcon className="size-4" />
                {t('cabinet')}
              </Link>
            </div>
          </div>
        </div>

        <HeroCarousel />
      </div>
    </section>
  )
}
