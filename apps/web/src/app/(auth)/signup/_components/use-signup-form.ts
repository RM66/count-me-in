'use client'

import { useRouter, useSearchParams } from 'next/navigation'
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
 * The two-step signup state machine: Telegram auth → profile creation.
 *
 * Extracted from the signup page so the component is left with rendering only.
 * If redirected from login with a ticket already (SIGNUP_REQUIRED flow), step 0
 * is skipped.
 */
export function useSignupForm() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [step, setStep] = useState(0)
  const [ticket, setTicket] = useState('')
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')

  const registerOrganizer = useRegisterOrganizer()
  const signIn = useSignInWithTicket()

  // If redirected from login with a ticket already (SIGNUP_REQUIRED flow), skip step 0.
  useEffect(() => {
    const t = searchParams.get('ticket')
    if (t) {
      setTicket(t)
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
      })
      await signIn.mutateAsync(ticket)
      router.push('/cabinet/settings')
      router.refresh()
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        // Ticket expired mid-registration — restart Telegram auth.
        toast.error(error.message)
        setStep(0)
        setTicket('')
      } else {
        toast.error(error instanceof Error ? error.message : 'Could not create the account')
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
