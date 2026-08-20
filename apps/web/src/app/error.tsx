'use client'

import * as Sentry from '@sentry/nextjs'
import { HomeIcon, RotateCwIcon, TriangleAlertIcon } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useEffect } from 'react'

import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'

/**
 * Segment-level error boundary — catches errors in a route segment while the
 * root layout (and therefore the intl provider) stays mounted. Shares its
 * copy with `global-error.tsx`, which renders its own `<html>` and mounts a
 * self-contained provider instead.
 */
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  const t = useTranslations('GlobalError')

  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

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
