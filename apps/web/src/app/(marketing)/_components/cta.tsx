import { DEMO_CABINET_PATH, DEMO_ORGANIZER_PATH } from '@repo/contracts'
import { ArrowRight, LayoutDashboardIcon, TicketIcon } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

import { Button } from '@/components/ui/button'

export async function Cta() {
  const t = await getTranslations('Marketing.cta')

  return (
    <section className="border-t bg-muted/30">
      <div className="mx-auto max-w-4xl px-6 py-16 text-center sm:py-24">
        <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {t('title')}
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-muted-foreground text-pretty">{t('subtitle')}</p>
        <div className="mt-8 flex justify-center">
          <Button size="lg" asChild>
            <Link href="/signup">
              {t('getStarted')}
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
        </div>
        {/*
          Both sides of the read-only demo (ADR-010) — the last chance to try
          the product before leaving the page. Explicit about whose view each
          one is, so the pair explains itself.
        */}
        <div className="mt-10 flex flex-col items-center gap-3">
          <p className="text-sm text-muted-foreground">{t('exploreDemo')}</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button variant="outline" asChild>
              <Link href={DEMO_ORGANIZER_PATH}>
                <TicketIcon data-icon="inline-start" />
                {t('guestPage')}
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href={DEMO_CABINET_PATH}>
                <LayoutDashboardIcon data-icon="inline-start" />
                {t('cabinet')}
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
