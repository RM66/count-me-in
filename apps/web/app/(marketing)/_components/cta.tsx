import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowRight } from 'lucide-react'

export function Cta() {
  return (
    <section className="border-t bg-muted/30">
      <div className="mx-auto max-w-4xl px-6 py-16 text-center sm:py-24">
        <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Ready to fill your next class?
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-muted-foreground text-pretty">
          Set up your first bookable service today. It only takes a few minutes.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button size="lg" asChild>
            <Link href="/signup">
              Get started free
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href="/studio-lumen">Browse an example page</Link>
          </Button>
        </div>
      </div>
    </section>
  )
}
