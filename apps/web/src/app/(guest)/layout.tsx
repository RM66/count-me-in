import Image from 'next/image'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'

import { LanguageSwitcher } from '@/components/language-switcher'

export default async function GuestLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('GuestLayout')

  return (
    <div className="flex min-h-screen flex-col bg-muted/20">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/logo.svg" alt="" width={22} height={22} className="size-5" />
            <span className="text-sm font-semibold">CountMeIn</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/booking" className="text-sm text-muted-foreground hover:text-foreground">
              {t('myBookings')}
            </Link>
            <LanguageSwitcher />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">{children}</main>
      <footer className="border-t bg-background">
        <div className="mx-auto flex max-w-3xl items-center justify-center gap-1 px-4 py-4 text-xs text-muted-foreground">
          {t('poweredBy')}
          <Link href="/" className="font-medium text-foreground hover:underline">
            CountMeIn
          </Link>
        </div>
      </footer>
    </div>
  )
}
