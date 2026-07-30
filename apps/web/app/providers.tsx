'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { SessionProvider } from 'next-auth/react'
import { type ReactNode, useState } from 'react'

import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'

const isProduction = process.env.NODE_ENV === 'production'

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Disable automatic refetching on window focus in development
            refetchOnWindowFocus: isProduction,
            // Retry failed requests once
            retry: 1,
            // Cache data for 5 minutes
            staleTime: 5 * 60 * 1000,
          },
          mutations: {
            // Retry failed mutations once
            retry: 1,
          },
        },
      }),
  )

  return (
    // `SessionProvider` lets statically rendered pages (the landing is
    // `force-static`) read the session on the client instead of at render time.
    // `useSession()` hits `/api/auth/session`, which only decodes the JWT — no
    // database round-trip on the highest-traffic page.
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
        <Toaster />
        {!isProduction && <ReactQueryDevtools initialIsOpen={false} />}
      </QueryClientProvider>
    </SessionProvider>
  )
}
