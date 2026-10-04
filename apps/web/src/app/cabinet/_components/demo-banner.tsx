'use client'

import { EyeIcon } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'

import { useIsDemo } from '@/api-client'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

/**
 * Read-only notice shown across the cabinet when viewing the demo organizer —
 * which is what anonymous visitors get, since `/cabinet` needs no session
 * (ADR-010). Renders nothing for real accounts.
 *
 * The banner explains *why* controls are disabled; it is not the enforcement
 * mechanism — every write endpoint rejects demo/anonymous callers server-side.
 */
export function DemoBanner() {
  const isDemo = useIsDemo()
  const t = useTranslations('Cabinet.demoBanner')

  if (!isDemo) return null

  return (
    <div className="px-4 pt-4 md:px-6">
      <Alert className="border-dashed bg-muted/50">
        <EyeIcon className="text-muted-foreground" />
        <AlertDescription className="flex flex-wrap items-center gap-3">
          <span className="flex-1">
            <span className="font-medium text-foreground">{t('readOnly')}</span> {t('text')}
          </span>
          <Button size="sm" asChild>
            <Link href="/signup">{t('createOwn')}</Link>
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  )
}
