'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useCookieConsent } from '@/hooks/use-cookie-consent'

/**
 * Unobtrusive bottom consent bar. Shows only while the choice is undecided.
 * Analytics (PostHog) stays off until "Accept" — see app/providers.tsx.
 */
export function CookieConsentBanner() {
  const { consent, accept, reject } = useCookieConsent()
  const [mounted, setMounted] = useState(false)

  // Avoid SSR/hydration mismatch: the choice lives in localStorage.
  useEffect(() => setMounted(true), [])

  if (!mounted || consent !== null) return null

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-50 px-4 pb-4"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3 rounded-2xl border border-border bg-background/95 p-4 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
          {'We use analytics cookies to understand how CountMeIn is used and improve it. '}
          {'Essential cookies for sign-in and booking are always on. '}
          <Link
            href="/privacy"
            className="font-medium underline underline-offset-4 decoration-[rgba(127,127,127,0.33)] hover:text-foreground"
          >
            Privacy Policy
          </Link>
        </p>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={reject}>
            Reject
          </Button>
          <Button size="sm" onClick={accept}>
            Accept
          </Button>
        </div>
      </div>
    </div>
  )
}
