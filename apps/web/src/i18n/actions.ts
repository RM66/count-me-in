'use server'

import { isAppLocale, isDemoOrganizerId } from '@repo/contracts'
import { cookies } from 'next/headers'

import { auth } from '@/server/auth'
import { updateOrganizerLanguage } from '@/server/db/organizer'

/**
 * Persist the viewer's language choice (ADR-011).
 *
 * A server action so the cookie is set in one place and only supported locales
 * ever get stored. The switcher calls this and then `router.refresh()` — the
 * request config re-resolves the locale from the cookie and re-renders the
 * server tree, while `NextIntlClientProvider` gets fresh messages.
 *
 * For a signed-in organizer this is the *single* language setting: besides the
 * interface cookie it also updates `organizers.language`, the locale the worker
 * renders their booking notifications in. Anonymous visitors (guests, demo
 * cabinet) only get the cookie — their notification language is captured
 * elsewhere (`bookings.guest_locale`, at booking time).
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
  if (organizerId && !isDemoOrganizerId(organizerId)) {
    await updateOrganizerLanguage(organizerId, value)
  }
}
