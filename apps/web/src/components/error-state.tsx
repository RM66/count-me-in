'use client'

import { HomeIcon, RotateCwIcon, TriangleAlertIcon } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'

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
 * The error-boundary body shared by `error.tsx` and `global-error.tsx`:
 * translated copy (the `GlobalError` namespace) over the Empty pattern.
 * `global-error.tsx` mounts its own intl provider above this; `error.tsx`
 * inherits the root layout's.
 */
export function ErrorState({ onRetry }: { onRetry: () => void }) {
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
            <Button onClick={onRetry}>
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
