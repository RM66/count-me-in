import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import { CabinetSidebar } from '@/app/cabinet/_components/cabinet-sidebar'
import { DemoBanner } from '@/app/cabinet/_components/demo-banner'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'

/**
 * The cabinet is reachable without a session — anonymous visitors get the
 * read-only demo (ADR-010) — so it must be kept out of search results.
 * Otherwise `/cabinet/settings` and friends compete with the landing page and
 * look like leaked private data. Inherited by every nested cabinet page.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function CabinetLayout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <CabinetSidebar />
      <SidebarInset>
        {/* Renders only when viewing the read-only demo (ADR-010). */}
        <DemoBanner />
        {children}
      </SidebarInset>
    </SidebarProvider>
  )
}
