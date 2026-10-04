'use client'

import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { type AppLocale, DEFAULT_LOCALE, isAppLocale } from '@repo/contracts'
import { registerOrganizerInput } from '@repo/contracts'
import { useRouter, useSearchParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import type { z } from 'zod'

import { ApiError, errorMessage, useRegisterOrganizer, useSignInWithTicket } from '@/api-client'

/**
 * sessionStorage key for the login → signup ticket handoff. A ticket
 * is a single-use, 10-minute credential: putting it in the URL would land
 * it in history, logs and `Referer` headers — the same reason `manageToken`
 * is sent in request bodies.
 */
export const SIGNUP_TICKET_KEY = 'countmein:signup-ticket'

/**
 * Pre-select the visitor's own timezone.
 *
 * `resolvedOptions().timeZone` is always a valid IANA name when present, so
 * it wins even when it is not in the curated `TIMEZONES` list — the caller
 * then adds it to the dropdown options so the `Select` is never blank. Only
 * an absent value falls back, to UTC.
 */
export function detectTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
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
 * Client-side validation for the profile step — the same contract fields the
 * API enforces (slug shape and reserved words included), so an obviously
 * wrong value fails before the request leaves. `ticket`/`language` are not
 * form fields: the ticket comes from the Telegram step and the language is
 * derived, both attached at submit.
 */
const signupFormSchema = registerOrganizerInput.pick({
  name: true,
  slug: true,
  timezone: true,
})
export type SignupFormValues = z.infer<typeof signupFormSchema>

/**
 * The two-step signup state machine: Telegram auth → profile creation.
 *
 * Extracted from the signup page so the component is left with rendering only.
 * If redirected from login with a ticket already (SIGNUP_REQUIRED flow), step 0
 * is skipped. Field state is React Hook Form driven by `signupFormSchema`;
 * the ticket stays separate state because it is a credential, not user input.
 */
export function useSignupForm() {
  const router = useRouter()
  const t = useTranslations('Auth.signup')
  const locale = useLocale()
  const searchParams = useSearchParams()

  // A ticket already minted means the Telegram step is done: the login →
  // signup handoff stores it in sessionStorage, and a legacy `?ticket=` URL
  // is still honoured (scrubbed from history by the effect below).
  //
  // The URL param is visible to SSR too, so it may seed the initial render.
  // sessionStorage exists only in the browser — reading it in a state
  // initializer would render a different step than the server sent (a
  // hydration mismatch), so that source is picked up by the mount effect.
  const [initialTicket] = useState(() => searchParams.get('ticket') ?? '')
  const [step, setStep] = useState(initialTicket ? 1 : 0)
  const [ticket, setTicket] = useState(initialTicket)

  const form = useForm<SignupFormValues>({
    resolver: standardSchemaResolver(signupFormSchema),
    // `Intl` reports the server's zone during SSR, so the visitor's zone is
    // filled post-mount (see the effect below) — `''` renders the Select's
    // placeholder meanwhile.
    defaultValues: { name: '', slug: '', timezone: '' },
  })

  useEffect(() => {
    const stored = sessionStorage.getItem(SIGNUP_TICKET_KEY)
    // Consume-on-read: dropping the key keeps a later visit (once the ticket
    // is spent) from skipping step 0.
    sessionStorage.removeItem(SIGNUP_TICKET_KEY)
    if (stored) {
      setTicket(stored)
      setStep(1)
    }
    // Back-compat: scrub the one-time credential from the address bar of a
    // `?ticket=` link so it does not linger in history or Referer headers.
    if (searchParams.get('ticket')) {
      const url = new URL(window.location.href)
      url.searchParams.delete('ticket')
      window.history.replaceState(null, '', url)
    }
    // Browser-only zone — see `defaultValues` above. `getValues` is a read,
    // not a subscription, so an empty check keeps any value already set.
    if (!form.getValues('timezone')) {
      form.setValue('timezone', detectTimezone())
    }
  }, [searchParams, form])

  const registerOrganizer = useRegisterOrganizer()
  const signIn = useSignInWithTicket()

  const pending = registerOrganizer.isPending || signIn.isPending

  const submit = form.handleSubmit(async (values) => {
    try {
      await registerOrganizer.mutateAsync({
        ...values,
        ticket,
        language: detectLanguage(locale),
      })
      await signIn.mutateAsync(ticket)
      router.push('/cabinet/settings')
      router.refresh()
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        // Ticket expired mid-registration — restart Telegram auth.
        toast.error(errorMessage(error, t('signInFailed')))
        setStep(0)
        setTicket('')
      } else {
        toast.error(errorMessage(error, t('createFailed')))
      }
    }
  })

  return {
    form,
    step,
    setStep,
    ticket,
    setTicket,
    pending,
    signIn,
    router,
    submit,
  }
}
