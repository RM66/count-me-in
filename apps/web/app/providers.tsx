'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { SessionProvider, useSession } from 'next-auth/react'
import { type ReactNode, useEffect, useState } from 'react'

import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { identifyOrganizer, initPostHog, resetPostHog } from '@/lib/posthog'

const isProduction = process.env.NODE_ENV === 'production'

/** Inits PostHog and identifies the signed-in organizer. Guests stay anonymous. */
function PostHogIdentity() {
  const { data: session, status } = useSession()

  useEffect(() => {
    initPostHog()
  }, [])

  useEffect(() => {
    if (status === 'authenticated' && session?.user?.id) {
      identifyOrganizer(session.user.id)
    } else if (status === 'unauthenticated') {
      resetPostHog()
    }
  }, [status, session?.user?.id])

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
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
        <Toaster />
        {!isProduction && <ReactQueryDevtools initialIsOpen={false} />}
      </QueryClientProvider>
    </SessionProvider>
  )
}
