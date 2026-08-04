import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { AuthShell } from '@/app/(auth)/_components/auth-shell'
import { auth, signIn } from '@/lib/server/auth'
import { peekLoginLink } from '@/lib/server/auth/login-link'
import { LoginLinkForm } from './_components/login-link-form'

/**
 * `/login/link/{token}` — the one-time login link from a notification message.
 *
 * Exists because `/cabinet` needs no session: an organizer who taps a
 * notification in a browser without a session cookie would land in the
 * read-only *demo* cabinet (ADR-010) instead of their own bookings. The token
 * was delivered into their verified Telegram chat, so it stands in for the
 * login — the same argument as `manageToken` for guests (ADR-002).
 *
 * **The `GET` deliberately does not consume the token.** Telegram's link
 * preview crawler and corporate link scanners fetch URLs before any human
 * clicks, so a single-use token spent on render would be burned by a robot.
 * Consumption happens on the `POST` this page auto-submits.
 *
 * Failure is always a redirect to `/login`, never an error message: whether a
 * token is unknown, expired or already spent is not something an anonymous
 * visitor should be able to distinguish.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default async function LoginLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const payload = await peekLoginLink(token)
  if (!payload) {
    redirect('/login')
  }

  const next = payload.next

  // Already signed in as this organizer? Then the link has nothing left to do.
  const session = await auth()
  if (session?.user?.id === payload.organizerId) {
    redirect(next)
  }

  /**
   * Spend the token and establish the session.
   * A server action rather than a route handler: it is a `POST` bound to this
   * page's form, so there is no separate endpoint to guard, and Next's action
   * ids are per-build rather than a stable URL a scanner might follow.
   */
  async function consume() {
    'use server'

    try {
      await signIn('telegram', { loginLinkToken: token, redirectTo: next })
    } catch (error) {
      if (error instanceof Error && error.message === 'NEXT_REDIRECT') throw error
      if (
        typeof error === 'object' &&
        error !== null &&
        'digest' in error &&
        typeof error.digest === 'string' &&
        error.digest.startsWith('NEXT_REDIRECT')
      ) {
        throw error
      }

      redirect('/login')
    }
  }

  return (
    <AuthShell title="Opening your cabinet…" description="Signing you in from your Telegram link.">
      <LoginLinkForm action={consume} />
    </AuthShell>
  )
}
