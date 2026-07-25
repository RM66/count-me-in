import { Hero } from '@/app/(marketing)/_components/hero'
import { HowItWorks } from '@/app/(marketing)/_components/how-it-works'
import { Features } from '@/app/(marketing)/_components/features'
import { Cta } from '@/app/(marketing)/_components/cta'

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
