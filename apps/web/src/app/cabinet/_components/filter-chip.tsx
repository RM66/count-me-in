'use client'

import { XIcon } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

/**
 * A filter chip: a badge showing the active filter label with a ✕ that clears
 * it.
 *
 * Two clear styles, exactly one required:
 * - `clearHref` for URL-based filters — a `Link` so back/forward keeps
 *   working, the contract every cabinet filter shares.
 * - `onClear` for local state (the day filter).
 */
export function FilterChip({
  label,
  clearHref,
  onClear,
  ariaLabel,
}: {
  label: string
  /** URL to navigate to when the chip is cleared (the unfiltered page). */
  clearHref?: string
  /** Clears a locally-held filter — mutually exclusive with `clearHref`. */
  onClear?: () => void
  /** Accessible name for the clear button; defaults to a generic label. */
  ariaLabel?: string
}) {
  const t = useTranslations('Cabinet.common')
  const label_ = ariaLabel ?? t('clearFilter')
  return (
    <Badge variant="secondary" className="h-6 gap-1 py-1 pe-1 ps-2.5 text-sm text-primary">
      <span className="truncate">{label}</span>
      {clearHref ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-5 shrink-0 hover:bg-transparent"
          asChild
        >
          <Link href={clearHref} aria-label={label_}>
            <XIcon />
          </Link>
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className="size-5 shrink-0 hover:bg-transparent"
          onClick={onClear}
          aria-label={label_}
        >
          <XIcon />
        </Button>
      )}
    </Badge>
  )
}
