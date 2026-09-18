/** Contract-violation reporting for api-client responses (stage 5, D7). */

import { wire } from '@repo/contracts/wire'
import * as Sentry from '@sentry/nextjs'
import type { z } from 'zod'

/**
 * A 2xx body failed its envelope schema: the server and the client disagree
 * about the wire. The data is returned as-is (no white screen); the mismatch
 * throws in tests, logs in development, and reports to Sentry in production.
 */
export function reportContractViolation(url: string, schemaId: string, error: z.ZodError): void {
  const detail = `api contract violation at ${url} (${schemaId}): ${error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ')}`
  if (process.env.NODE_ENV === 'test') {
    throw new Error(detail)
  }
  if (process.env.NODE_ENV === 'development') {
    console.error(detail)
    return
  }
  Sentry.captureMessage('api contract violation', {
    level: 'warning',
    extra: { url, schemaId, issues: error.issues },
  })
}

export function schemaIdOf(schema: z.ZodType): string {
  return wire.get(schema)?.id ?? 'unknown'
}
