'use client'

import { EyeIcon } from 'lucide-react'
import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { useIsDemo } from '@/api-client'

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

  if (!isDemo) return null

  return (
    <div className="px-4 pt-4 md:px-6">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed bg-muted/50 px-4 py-3">
        <EyeIcon className="size-4 shrink-0 text-muted-foreground" />
        <p className="flex-1 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Read-only demo.</span> This is example data
          — editing is disabled and nothing here is saved.
        </p>
        <Button size="sm" asChild>
          <Link href="/signup">Create your own</Link>
        </Button>
      </div>
    </div>
  )
}
