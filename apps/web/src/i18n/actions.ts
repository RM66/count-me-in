'use server'

import { isAppLocale, isDemoOrganizerId } from '@repo/contracts'
import { cookies } from 'next/headers'

import { goApiFetch } from '@/server/api'
import { auth } from '@/server/auth'

/**
 * Persist the viewer's language choice (ADR-011).
 *
 * A server action so the cookie is set in one place and only supported locales
 * ever get stored. The switcher calls this and then `router.refresh()` — the
 * request config re-resolves the locale from the cookie and re-renders the
 * server tree, while `NextIntlClientProvider` gets fresh messages.
 *
 * For a signed-in organizer this is the *single* language setting: besides the
 * interface cookie it also syncs `organizers.language` (the locale the
 * notification job renders their booking messages in) via the Go API — the
 * write moved out of the TS server layer (Phase 3.2). Anonymous visitors
 * (guests, demo cabinet) only get the cookie — their notification language is
 * captured elsewhere (`bookings.guest_locale`, at booking time).
 */

export async function setLocale(value: string): Promise<void> {
  if (!isAppLocale(value)) return

  const cookieStore = await cookies()
  cookieStore.set('NEXT_LOCALE', value, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    // Localhost is served over plain http in dev; production is always https.
    secure: process.env.NODE_ENV === 'production',
  })

  const organizerId = (await auth())?.user?.id
  if (!organizerId || isDemoOrganizerId(organizerId)) return

  // Best-effort: the cookie is already set (the primary user-facing effect).
  // The DB sync is for notification language — a failure logs but does not
  // break the switcher, since the UI locale is driven by the cookie.
  const res = await goApiFetch('/api/organizers/me/language', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language: value }),
  })
  if (!res.ok) {
    console.error('failed to sync organizer language', { status: res.status })
  }
}
