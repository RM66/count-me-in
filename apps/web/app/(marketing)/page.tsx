import { Cta } from '@/app/(marketing)/_components/cta'
import { Features } from '@/app/(marketing)/_components/features'
import { Hero } from '@/app/(marketing)/_components/hero'
import { HowItWorks } from '@/app/(marketing)/_components/how-it-works'

// Static marketing content (no DB / dynamic APIs) — prerendered at build time.
export const dynamic = 'force-static'

export default function Home() {
  return (
    <main className="flex-1">
      <Hero />
      <HowItWorks />
      <Features />
      <Cta />
    </main>
  )
}
