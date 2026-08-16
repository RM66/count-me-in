'use client'

import { GlobeIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

/**
 * Language picker shown on the right of every section header.
 *
 * MVP: markup only, English is the sole option — no i18n wiring yet. Kept as a
 * single shared component so each section layout renders the exact same control.
 *
 * Pass `trigger` to render a custom control (e.g. a `SidebarMenuButton`) instead
 * of the default outline button; the dropdown with the language list is handled
 * for you. When omitted, a compact outline button showing the active language
 * code is rendered.
 */

export type Language = { code: string; label: string }

export const ACTIVE_LANGUAGE: Language = { code: 'en', label: 'English' }

export const LANGUAGES: Language[] = [ACTIVE_LANGUAGE]

export function LanguageSwitcher({
  className,
  trigger,
}: {
  className?: string
  /**
   * Render a custom trigger control (e.g. a `SidebarMenuButton`) instead of the
   * default outline button; receives the active language so the caller can show
   * its label. The dropdown with the language list is handled for you.
   */
  trigger?: (active: Language) => ReactNode
}) {
  const active = ACTIVE_LANGUAGE

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger ? (
          trigger(active)
        ) : (
          <Button
            variant="outline"
            size="sm"
            className={cn('gap-2', className)}
            aria-label="Change language"
          >
            <GlobeIcon className="size-4" />
            <span>{active.code.toUpperCase()}</span>
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        {LANGUAGES.map((language) => (
          <DropdownMenuItem key={language.code}>{language.label}</DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
