import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { CalendarCheck } from 'lucide-react'

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-8 px-6 text-center">
      <Image
        src="/logo.svg"
        alt="CountMeIn logo"
        width={160}
        height={160}
        className="size-40"
        priority
      />

      <div className="flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm text-muted-foreground">
        <CalendarCheck className="size-4" />
        Online booking for group events
      </div>

      <div className="space-y-4">
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          CountMeIn
        </h1>
        <p className="mx-auto max-w-xl text-lg text-muted-foreground text-balance">
          Organizers publish services with time slots and capacity. Guests book on a public page —
          no account needed.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button size="lg">Get started</Button>
        <Button size="lg" variant="outline">
          Learn more
        </Button>
      </div>
    </main>
  )
}
