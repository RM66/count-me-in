'use client'

import { GlobeIcon } from 'lucide-react'

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
 */

type Language = { code: string; label: string }

const ACTIVE_LANGUAGE: Language = { code: 'en', label: 'English' }

const LANGUAGES: Language[] = [ACTIVE_LANGUAGE]

export function LanguageSwitcher({ className }: { className?: string }) {
  const active = ACTIVE_LANGUAGE

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn('gap-2', className)}
          aria-label="Change language"
        >
          <GlobeIcon className="size-4" />
          <span>{active.code.toUpperCase()}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        {LANGUAGES.map((language) => (
          <DropdownMenuItem key={language.code}>{language.label}</DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
