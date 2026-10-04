import { localeDirection } from '@repo/contracts'
import type { Metadata } from 'next'
import { Figtree, Manrope } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages, getTranslations } from 'next-intl/server'

import { SITE_NAME, SITE_URL } from '@/constants/site'
import { rootClientMessages } from '@/i18n/messages'
import { cn } from '@/lib/utils'
import { auth } from '@/server/auth'
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

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Marketing')
  return {
    metadataBase: new URL(SITE_URL),
    title: {
      default: t('metaTitle'),
      template: '%s · CountMeIn',
    },
    description: t('ogDescription'),
    applicationName: SITE_NAME,
    // Canonical, per-page OG/Twitter text and og:image come from each page's
    // own metadata (`pageMetadata`) plus the file-convention
    // `opengraph-image.tsx` — values set here would cascade onto every
    // subpage verbatim.
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
    },
    twitter: {
      card: 'summary_large_image',
    },
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // Locale from the request config (cookie → Accept-Language → en, ADR-011).
  // The layouts are dynamic anyway (the locale read touches cookies), so the
  // session is read on the server once — seeding it into SessionProvider
  // saves every visitor a client-side /api/auth/session fetch.
  const [locale, messages, session] = await Promise.all([getLocale(), getMessages(), auth()])
  // Only the namespaces root-level client components need — each route-group
  // layout nests a provider with its own pick (see i18n/messages.ts).
  const picked = rootClientMessages(messages)

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
        <NextIntlClientProvider locale={locale} messages={picked}>
          <Providers session={session}>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
