import type { ReactNode } from 'react'

import { CabinetSidebar } from '@/app/cabinet/_components/cabinet-sidebar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'

export default function CabinetLayout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <CabinetSidebar />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  )
}
