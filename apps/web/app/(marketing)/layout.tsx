import type { ReactNode } from 'react'
import { SiteHeader } from '@/app/(marketing)/_components/site-header'
import { SiteFooter } from '@/app/(marketing)/_components/site-footer'

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      {children}
      <SiteFooter />
    </div>
  )
}
