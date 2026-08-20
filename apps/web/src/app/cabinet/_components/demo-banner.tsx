'use client'

import { EyeIcon } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'

import { useIsDemo } from '@/api-client'
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
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed bg-muted/50 px-4 py-3">
        <EyeIcon className="size-4 shrink-0 text-muted-foreground" />
        <p className="flex-1 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{t('readOnly')}</span> {t('text')}
        </p>
        <Button size="sm" asChild>
          <Link href="/signup">{t('createOwn')}</Link>
        </Button>
      </div>
    </div>
  )
}
