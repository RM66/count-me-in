import Image from 'next/image'
import Link from 'next/link'
import type { ReactNode } from 'react'

export default function GuestLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-muted/20">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/logo.svg" alt="" width={22} height={22} className="size-5" />
            <span className="text-sm font-semibold">CountMeIn</span>
          </Link>
          <Link href="/booking" className="text-sm text-muted-foreground hover:text-foreground">
            My bookings
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">{children}</main>
      <footer className="border-t bg-background">
        <div className="mx-auto flex max-w-3xl items-center justify-center gap-1 px-4 py-4 text-xs text-muted-foreground">
          Powered by
          <Link href="/" className="font-medium text-foreground hover:underline">
            CountMeIn
          </Link>
        </div>
      </footer>
    </div>
  )
}
