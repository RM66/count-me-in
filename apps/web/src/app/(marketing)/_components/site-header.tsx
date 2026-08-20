'use client'

import { DEMO_ORGANIZER_PATH } from '@repo/contracts'
import { Menu } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useTranslations } from 'next-intl'

import { LanguageSwitcher } from '@/components/language-switcher'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'

/**
 * Auth actions in the header.
 *
 * Signed-in organizers get a single shortcut to their cabinet instead of
 * "Log in / Get started" — the landing itself stays reachable rather than
 * redirecting them away, so it can still be shared and reviewed while logged
 * in.
 *
 * While the session is loading we render the anonymous variant: the landing
 * has no server-known session to render from, and flashing a skeleton in the
 * header on every visit is worse than a brief swap for the minority who are
 * signed in.
 */
function AuthActions({ className }: { className?: string }) {
  const { data: session } = useSession()
  const t = useTranslations('Marketing.header')

  if (session?.user) {
    return (
      <Button className={className} asChild>
        <Link href="/cabinet">{t('goToCabinet')}</Link>
      </Button>
    )
  }

  return (
    <>
      <Button variant="ghost" className={className} asChild>
        <Link href="/login">{t('logIn')}</Link>
      </Button>
      <Button className={className} asChild>
        <Link href="/signup">{t('getStarted')}</Link>
      </Button>
    </>
  )
}

export function SiteHeader() {
  const t = useTranslations('Marketing.header')

  const nav = [
    { label: t('howItWorks'), href: '/#how-it-works' },
    { label: t('features'), href: '/#features' },
    { label: t('examples'), href: DEMO_ORGANIZER_PATH },
  ]

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-6">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/logo.svg" alt="" width={28} height={28} className="size-7" />
          <span className="text-lg font-semibold tracking-tight">CountMeIn</span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <AuthActions />
          <LanguageSwitcher />
        </div>

        <div className="flex items-center gap-2 md:hidden">
          <LanguageSwitcher />
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon">
                <Menu />
                <span className="sr-only">{t('openMenu')}</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72">
              <SheetTitle className="sr-only">{t('navigation')}</SheetTitle>
              <div className="flex flex-col gap-1 p-4">
                {nav.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded-md px-3 py-2 text-sm font-medium hover:bg-accent"
                  >
                    {item.label}
                  </Link>
                ))}
                <div className="mt-4 flex flex-col gap-2">
                  <AuthActions className="w-full" />
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  )
}
