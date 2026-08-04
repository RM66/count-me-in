import { DEMO_CABINET_PATH, DEMO_ORGANIZER_PATH } from '@repo/api-contracts'
import { ArrowRight, LayoutDashboardIcon, TicketIcon } from 'lucide-react'
import Link from 'next/link'

import { Button } from '@/components/ui/button'

export function Cta() {
  return (
    <section className="border-t bg-muted/30">
      <div className="mx-auto max-w-4xl px-6 py-16 text-center sm:py-24">
        <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Ready to fill your next event?
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-muted-foreground text-pretty">
          Set up your first bookable service today. It only takes a few minutes.
        </p>
        <div className="mt-8 flex justify-center">
          <Button size="lg" asChild>
            <Link href="/signup">
              Get started free
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
          <p className="text-sm text-muted-foreground">Or explore the demo — no signup needed:</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Button variant="outline" asChild>
              <Link href={DEMO_ORGANIZER_PATH}>
                <TicketIcon data-icon="inline-start" />
                Guest booking page
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href={DEMO_CABINET_PATH}>
                <LayoutDashboardIcon data-icon="inline-start" />
                Organizer cabinet
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
