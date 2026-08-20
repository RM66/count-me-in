'use client'

import { type AppLocale, DEFAULT_LOCALE, isAppLocale } from '@repo/contracts'
import { useRouter, useSearchParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { ApiError, useRegisterOrganizer, useSignInWithTicket } from '@/api-client'

const FALLBACK_TIMEZONE = 'Europe/Belgrade'

/**
 * Pre-select the visitor's own timezone when we offer it.
 *
 * The browser can report a zone that is not in `TIMEZONES` (the list is a
 * curated subset), and an unlisted value would leave the `Select` blank with no
 * hint that anything is wrong — so an unknown zone falls back to a listed one.
 */
export function detectTimezone(timezones: { value: string }[]): string {
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
  return timezones.some((tz) => tz.value === detected) ? detected : FALLBACK_TIMEZONE
}

/**
 * The organizer's notification language from the active UI locale (ADR-011):
 * the language the visitor chose on the site (cookie → Accept-Language → en),
 * not the raw browser preference — the switcher is the single language
 * setting, and signup must not contradict what the visitor is reading.
 */
export function detectLanguage(locale: string): AppLocale {
  return isAppLocale(locale) ? locale : DEFAULT_LOCALE
}

/**
 * The two-step signup state machine: Telegram auth → profile creation.
 *
 * Extracted from the signup page so the component is left with rendering only.
 * If redirected from login with a ticket already (SIGNUP_REQUIRED flow), step 0
 * is skipped.
 */
export function useSignupForm() {
  const router = useRouter()
  const t = useTranslations('Auth.signup')
  const locale = useLocale()
  const searchParams = useSearchParams()

  const [step, setStep] = useState(0)
  const [ticket, setTicket] = useState('')
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')

  const registerOrganizer = useRegisterOrganizer()
  const signIn = useSignInWithTicket()

  // If redirected from login with a ticket already (SIGNUP_REQUIRED flow), skip step 0.
  useEffect(() => {
    const ticketParam = searchParams.get('ticket')
    if (ticketParam) {
      setTicket(ticketParam)
      setStep(1)
    }
  }, [searchParams])

  const pending = registerOrganizer.isPending || signIn.isPending

  async function handleCreateAccount(e: React.FormEvent, timezone: string) {
    e.preventDefault()
    try {
      await registerOrganizer.mutateAsync({
        ticket,
        slug,
        name,
        timezone,
        language: detectLanguage(locale),
      })
      await signIn.mutateAsync(ticket)
      router.push('/cabinet/settings')
      router.refresh()
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        // Ticket expired mid-registration — restart Telegram auth.
        toast.error(error.message || t('signInFailed'))
        setStep(0)
        setTicket('')
      } else {
        toast.error(error instanceof Error ? error.message || t('createFailed') : t('createFailed'))
      }
    }
  }

  return {
    step,
    setStep,
    ticket,
    setTicket,
    name,
    setName,
    slug,
    setSlug,
    pending,
    signIn,
    router,
    handleCreateAccount,
  }
}
