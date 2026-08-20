'use client'

import { GlobeIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useTransition } from 'react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DEFAULT_LANGUAGE, LANGUAGES } from '@/constants/languages'
import { setLocale } from '@/i18n/actions'
import { cn } from '@/lib/utils'

/**
 * Language picker shown on the right of every section header.
 *
 * Switching persists the choice in the `NEXT_LOCALE` cookie (via the
 * `setLocale` server action) and re-renders the server tree with
 * `router.refresh()` — the request config then resolves the new locale for
 * both server and client components (ADR-011).
 */

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
  trigger?: (active: { code: string; label: string }) => React.ReactNode
}) {
  const locale = useLocale()
  const t = useTranslations('LocaleSwitcher')
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const active = LANGUAGES.find((language) => language.code === locale) ?? DEFAULT_LANGUAGE

  function onChange(code: string) {
    if (code === locale) return
    startTransition(async () => {
      await setLocale(code)
      router.refresh()
    })
  }

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
            aria-label={t('ariaLabel')}
            disabled={isPending}
          >
            <GlobeIcon className="size-4" />
            <span>{active.code.toUpperCase()}</span>
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        {LANGUAGES.map((language) => (
          <DropdownMenuItem
            key={language.code}
            disabled={language.code === locale}
            onSelect={() => onChange(language.code)}
          >
            {language.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
