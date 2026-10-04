import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import type { ReactNode } from 'react'

import { SiteFooter } from '@/app/(marketing)/_components/site-footer'
import { SiteHeader } from '@/app/(marketing)/_components/site-header'
import { segmentClientMessages } from '@/i18n/messages'

export default async function MarketingLayout({ children }: { children: ReactNode }) {
  // Client-side copy for this segment only (i18n/messages.ts) — the root
  // provider ships the shared base set, which this pick re-declares.
  const messages = segmentClientMessages(await getMessages(), ['Marketing'])
  return (
    <NextIntlClientProvider messages={messages}>
      <div className="flex min-h-screen flex-col">
        <SiteHeader />
        {children}
        <SiteFooter />
      </div>
    </NextIntlClientProvider>
  )
}
