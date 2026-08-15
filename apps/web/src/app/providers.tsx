'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { SessionProvider, useSession } from 'next-auth/react'
import { type ReactNode, useEffect, useState } from 'react'

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

export function Providers({ children }: { children: ReactNode }) {
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
    <SessionProvider>
      <PostHogIdentity />
      <Analytics />
      <SpeedInsights />
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
        <CookieConsentBanner />
        <Toaster />
        {!isProduction && <ReactQueryDevtools initialIsOpen={false} />}
      </QueryClientProvider>
    </SessionProvider>
  )
}
