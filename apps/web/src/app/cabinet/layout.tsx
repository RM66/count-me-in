import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query'
import type { Metadata } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import type { ReactNode } from 'react'

import { queryKeys } from '@/api-client/keys'
import { CabinetSidebar } from '@/app/cabinet/_components/cabinet-sidebar'
import { DemoBanner } from '@/app/cabinet/_components/demo-banner'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { segmentClientMessages } from '@/i18n/messages'
import { getOrganizerProfile } from '@/server/api-client'

/**
 * The cabinet is reachable without a session — anonymous visitors get the
 * read-only demo (ADR-010) — so it must be kept out of search results.
 * Otherwise `/cabinet/settings` and friends compete with the landing page and
 * look like leaked private data. Inherited by every nested cabinet page.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

/**
 * Every cabinet page needs the profile (timezone, name, `isDemo`), and the
 * client chrome reads it through React Query (`useCurrentOrganizer` /
 * `useIsDemo` → the banner, the sidebar, the forms). Fetch it once here
 * and seed `queryKeys.organizer.me` so the client cache *starts* warm —
 * no skeleton flash, no demo banner popping in after a request, no demo
 * form fields briefly enabled.
 */
export default async function CabinetLayout({ children }: { children: ReactNode }) {
  const [organizer, messages] = await Promise.all([
    getOrganizerProfile(),
    // Client-side copy for this segment only (i18n/messages.ts).
    getMessages().then((m) => segmentClientMessages(m, ['Cabinet'])),
  ])
  const queryClient = new QueryClient()
  if (organizer) {
    // The client query stores the envelope (its queryFn returns it; the
    // `select` picks `.organizer`), so seed the same shape.
    queryClient.setQueryData(queryKeys.organizer.me, { organizer })
  }

  return (
    <NextIntlClientProvider messages={messages}>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <SidebarProvider>
          <CabinetSidebar />
          <SidebarInset>
            {/* Renders only when viewing the read-only demo (ADR-010). */}
            <DemoBanner />
            {children}
          </SidebarInset>
        </SidebarProvider>
      </HydrationBoundary>
    </NextIntlClientProvider>
  )
}
