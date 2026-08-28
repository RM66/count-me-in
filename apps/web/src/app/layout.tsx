import { localeDirection } from '@repo/contracts'
import type { Metadata } from 'next'
import { Figtree, Manrope } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'

import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL } from '@/constants/site'
import { cn } from '@/lib/utils'
import { Providers } from './providers'

import './globals.css'

// Figtree ships latin subsets only. Russian therefore uses Manrope (full
// Cyrillic coverage); ar/ja fall back to the system sans stack in
// globals.css. Only the active locale's variable lands on <body>, but CSS
// for both fonts ships to every page — Manrope opts out of preloading so
// non-ru locales never fetch it, while Figtree preloads everywhere and ru
// pays for it as the cost of keeping first paint instant elsewhere.
const figtree = Figtree({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-sans',
})
const manrope = Manrope({
  subsets: ['cyrillic', 'cyrillic-ext', 'latin', 'latin-ext'],
  variable: '--font-sans',
  preload: false,
})

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: '%s · CountMeIn',
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  // Canonical, per-page OG/Twitter text and og:image come from each page's own
  // metadata (`pageMetadata`) plus the file-convention `opengraph-image.tsx` —
  // values set here would cascade onto every subpage verbatim.
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
  },
  twitter: {
    card: 'summary_large_image',
  },
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // Locale from the request config (cookie → Accept-Language → en, ADR-011).
  const locale = await getLocale()
  const messages = await getMessages()

  return (
    <html
      lang={locale}
      dir={localeDirection(locale)}
      suppressHydrationWarning
      className="bg-background"
    >
      <body
        className={cn(
          'font-sans',
          'antialiased',
          'text-foreground',
          locale === 'ru' ? manrope.variable : figtree.variable,
        )}
      >
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
