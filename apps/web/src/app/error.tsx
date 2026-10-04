'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

import { ErrorState } from '@/components/error-state'

/**
 * Segment-level error boundary — catches errors in a route segment while the
 * root layout (and therefore the intl provider) stays mounted. The body is
 * the shared `ErrorState`; `global-error.tsx` wraps it in its own `<html>`
 * and a self-contained provider instead.
 */
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return <ErrorState onRetry={reset} />
}
