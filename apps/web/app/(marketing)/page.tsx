import { Cta } from '@/app/(marketing)/_components/cta'
import { Features } from '@/app/(marketing)/_components/features'
import { Hero } from '@/app/(marketing)/_components/hero'
import { HowItWorks } from '@/app/(marketing)/_components/how-it-works'

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
