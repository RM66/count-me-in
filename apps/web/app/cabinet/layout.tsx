import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'

import { CabinetSidebar } from '@/app/cabinet/_components/cabinet-sidebar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { auth } from '@/lib/services/auth'

export default async function CabinetLayout({ children }: { children: ReactNode }) {
  const session = await auth()
  if (!session?.user) {
    redirect('/login')
  }

  return (
    <SidebarProvider>
      <CabinetSidebar />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  )
}
