'use client'

/** Global error boundary — catches root-layout errors that `error.tsx` cannot. Must render its own `<html>`/`<body>`. */
import { type AppLocale, DEFAULT_LOCALE, localeDirection, matchLocale } from '@repo/contracts'
import { WEB_MESSAGES } from '@repo/translations'
import * as Sentry from '@sentry/nextjs'
import { NextIntlClientProvider } from 'next-intl'
import { useEffect, useMemo } from 'react'

import { ErrorState } from '@/components/error-state'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  // This boundary renders its own <html>, so the root provider is not above
  // it. Resolve the locale client-side — NEXT_LOCALE cookie first (the same
  // precedence the server uses, ADR-011), then Accept-Language — and mount a
  // self-contained intl provider. Guard `navigator`/`document`: if this
  // boundary is ever server-rendered, browser globals must not exist for it
  // to crash inside the last-resort boundary.
  const locale: AppLocale = useMemo(() => {
    const cookie =
      typeof document === 'undefined'
        ? undefined
        : document.cookie.match(/(?:^|;\s*)NEXT_LOCALE=([^;]+)/)?.[1]
    const browserLangs =
      typeof navigator === 'undefined' ? undefined : navigator.languages.join(',')
    return matchLocale(cookie) ?? matchLocale(browserLangs) ?? DEFAULT_LOCALE
  }, [])

  return (
    <html lang={locale} dir={localeDirection(locale)}>
      <body className="font-sans antialiased text-foreground">
        <NextIntlClientProvider locale={locale} messages={WEB_MESSAGES[locale]}>
          <ErrorState onRetry={reset} />
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
