import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'

import { LanguageSwitcher } from '@/components/language-switcher'
import { segmentClientMessages } from '@/i18n/messages'

/**
 * Auth pages are utility surfaces, not landing content — kept out of search
 * indexes so they never compete with `/`. Inherited by login and signup.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Auth')
  return {
    robots: { index: false, follow: false },
    title: t('metaTitle'),
  }
}

export default async function AuthLayout({ children }: { children: ReactNode }) {
  // Client-side copy for this segment only (i18n/messages.ts).
  const messages = segmentClientMessages(await getMessages(), ['Auth'])
  return (
    <NextIntlClientProvider messages={messages}>
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
    </NextIntlClientProvider>
  )
}
