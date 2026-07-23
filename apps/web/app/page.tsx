import { SiteHeader } from '@/components/marketing/site-header'
import { SiteFooter } from '@/components/marketing/site-footer'
import { Hero } from '@/app/_components/hero'
import { HowItWorks } from '@/app/_components/how-it-works'
import { Features } from '@/app/_components/features'
import { Cta } from '@/app/_components/cta'

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <HowItWorks />
        <Features />
        <Cta />
      </main>
      <SiteFooter />
    </div>
  )
}
