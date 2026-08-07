'use client'

import { XIcon } from 'lucide-react'
import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

/**
 * A filter chip: a badge showing the active filter label with a ✕ that clears
 * it. The clear action is a `Link` so the URL-based filter is removed and the
 * browser's back/forward keep working — the same contract every cabinet filter
 * uses.
 *
 * Extracted from the three places that had this exact pattern: the bookings
 * table (slot + service chips), the slots table (service chip), and the cabinet
 * overview (active slot chip).
 */
export function FilterChip({
  label,
  clearHref,
  ariaLabel = 'Clear filter',
}: {
  label: string
  /** URL to navigate to when the chip is cleared (the unfiltered page). */
  clearHref: string
  /** Accessible name for the clear button. */
  ariaLabel?: string
}) {
  return (
    <Badge variant="secondary" className="gap-1 py-1 pr-1 pl-2.5 h-6 text-sm text-primary">
      <span className="truncate">{label}</span>
      <Button variant="ghost" size="icon" className="size-5 shrink-0 hover:bg-transparent" asChild>
        <Link href={clearHref} aria-label={ariaLabel}>
          <XIcon className="size-3.5" />
        </Link>
      </Button>
    </Badge>
  )
}
