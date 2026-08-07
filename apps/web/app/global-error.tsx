'use client'

/** Global error boundary — catches root-layout errors that `error.tsx` cannot. Must render its own `<html>`/`<body>`. */
import Sentry from '@sentry/nextjs'
import { HomeIcon, RotateCwIcon, TriangleAlertIcon } from 'lucide-react'
import Link from 'next/link'
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

  return (
    <html lang="en">
      <body className="font-sans antialiased text-foreground">
        <div className="flex min-h-[80vh] items-center justify-center p-6">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <TriangleAlertIcon />
              </EmptyMedia>
              <EmptyTitle>Something went wrong</EmptyTitle>
              <EmptyDescription>
                An unexpected error occurred on our end. Please try again in a moment.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={reset}>
                  <RotateCwIcon data-icon="inline-start" />
                  Try again
                </Button>
                <Button variant="outline" asChild>
                  <Link href="/">
                    <HomeIcon data-icon="inline-start" />
                    Back home
                  </Link>
                </Button>
              </div>
            </EmptyContent>
          </Empty>
        </div>
      </body>
    </html>
  )
}
