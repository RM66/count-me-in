'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { RealtimeProvider } from '@upstash/realtime/client'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import type { Session } from 'next-auth'
import { SessionProvider, useSession } from 'next-auth/react'
import { ThemeProvider } from 'next-themes'
import { type ReactNode, useEffect, useState } from 'react'

import { RealtimeConfiguredProvider } from '@/api-client/realtime'
import { CookieConsentBanner } from '@/components/cookie-consent-banner'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useCookieConsent } from '@/hooks/use-cookie-consent'
import { identifyOrganizer, initPostHog, resetPostHog } from '@/lib/posthog'

const isProduction = process.env.NODE_ENV === 'production'

/**
 * Inits PostHog and identifies the signed-in organizer. Guests stay anonymous.
 * Analytics is opt-in: nothing initializes until the visitor accepts cookies.
 */
function PostHogIdentity() {
  const { data: session, status } = useSession()
  const { consent } = useCookieConsent()

  useEffect(() => {
    if (consent === 'accepted') initPostHog()
  }, [consent])

  useEffect(() => {
    if (consent !== 'accepted') return
    if (status === 'authenticated' && session?.user?.id) {
      identifyOrganizer(session.user.id)
    } else if (status === 'unauthenticated') {
      resetPostHog()
    }
  }, [consent, status, session?.user?.id])

  return null
}

export function Providers({
  session,
  realtimeEnabled,
  children,
}: {
  /** Server-read Auth.js session — seeds the provider so no visitor (guests
   * included) pays a `GET /api/auth/session` round-trip on page load. */
  session: Session | null
  /** Whether the Upstash Realtime env pair exists — a boolean flag only,
   * the credentials never reach the browser (ADR-025). */
  realtimeEnabled: boolean
  children: ReactNode
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: isProduction,
            retry: 1,
            staleTime: 5 * 60 * 1000,
          },
          mutations: {
            retry: 1,
          },
        },
      }),
  )

  return (
    <SessionProvider session={session}>
      <PostHogIdentity />
      <Analytics />
      <SpeedInsights />
      <QueryClientProvider client={queryClient}>
        {/* RealtimeProvider is inert until `useRealtime` registers a
            channel — `realtimeEnabled` (env presence only) gates those
            subscriptions. */}
        {/* maxReconnectAttempts stays default: in the pinned version
            `connect()` resets the counter, so retries run ~1s forever —
            the periodic reconcile, not the cap, is the freshness floor. */}
        {/* `api.url` defaults to '/api/realtime' — the route below. */}
        <RealtimeProvider>
          <RealtimeConfiguredProvider value={realtimeEnabled}>
            <ThemeProvider
              attribute="class"
              defaultTheme="system"
              enableSystem
              disableTransitionOnChange
            >
              <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
              <CookieConsentBanner />
              <Toaster />
              {!isProduction && <ReactQueryDevtools initialIsOpen={false} />}
            </ThemeProvider>
          </RealtimeConfiguredProvider>
        </RealtimeProvider>
      </QueryClientProvider>
    </SessionProvider>
  )
}
