'use client'

/** Global error boundary — catches root-layout errors that `error.tsx` cannot. Must render its own `<html>`/`<body>`. */
import { type AppLocale,DEFAULT_LOCALE, matchLocale } from '@repo/contracts'
import { WEB_MESSAGES } from '@repo/translations'
import * as Sentry from '@sentry/nextjs'
import { HomeIcon, RotateCwIcon, TriangleAlertIcon } from 'lucide-react'
import Link from 'next/link'
import { NextIntlClientProvider } from 'next-intl'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo } from 'react'

import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'

function GlobalErrorContent({ reset }: { reset: () => void }) {
  const t = useTranslations('GlobalError')

  return (
    <div className="flex min-h-[80vh] items-center justify-center p-6">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TriangleAlertIcon />
          </EmptyMedia>
          <EmptyTitle>{t('title')}</EmptyTitle>
          <EmptyDescription>{t('description')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={reset}>
              <RotateCwIcon data-icon="inline-start" />
              {t('tryAgain')}
            </Button>
            <Button variant="outline" asChild>
              <Link href="/">
                <HomeIcon data-icon="inline-start" />
                {t('backHome')}
              </Link>
            </Button>
          </div>
        </EmptyContent>
      </Empty>
    </div>
  )
}

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
  // it. Detect the locale from the browser — the same Accept-Language matcher
  // the server uses — and mount a self-contained intl provider.
  const locale: AppLocale = useMemo(
    () => matchLocale(navigator.languages.join(',')) ?? DEFAULT_LOCALE,
    [],
  )

  return (
    <html lang={locale}>
      <body className="font-sans antialiased text-foreground">
        <NextIntlClientProvider locale={locale} messages={WEB_MESSAGES[locale]}>
          <GlobalErrorContent reset={reset} />
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
