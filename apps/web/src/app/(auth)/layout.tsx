import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { LanguageSwitcher } from '@/components/language-switcher'

/**
 * Auth pages are utility surfaces, not landing content — kept out of search
 * indexes so they never compete with `/`. Inherited by login and signup.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: 'Account access',
}

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="flex justify-end px-6 py-4">
        <LanguageSwitcher />
      </header>
      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-12">
        <Link href="/" className="mb-8 flex items-center gap-2">
          <Image src="/logo.svg" alt="" width={32} height={32} className="size-8" />
          <span className="text-xl font-semibold tracking-tight">CountMeIn</span>
        </Link>
        {children}
      </div>
    </div>
  )
}
