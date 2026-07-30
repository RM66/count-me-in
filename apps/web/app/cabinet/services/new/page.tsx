import { redirect } from 'next/navigation'

import { CabinetHeader } from '@/app/cabinet/_components/cabinet-header'
import { ServiceForm } from '@/app/cabinet/services/_components/service-form'
import { isDemoSession } from '@/lib/services/demo'

export default async function NewServicePage() {
  // The demo account cannot create services (ADR-010). The entry point is
  // disabled in the UI, but the route is still reachable by URL — bounce it.
  if (await isDemoSession()) {
    redirect('/cabinet/services')
  }

  return (
    <>
      <CabinetHeader
        crumbs={[
          { label: 'Cabinet', href: '/cabinet' },
          { label: 'Services', href: '/cabinet/services' },
          { label: 'New' },
        ]}
      />
      <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">New service</h1>
          <p className="text-sm text-muted-foreground">Create an experience guests can book.</p>
        </div>
        <ServiceForm />
      </div>
    </>
  )
}
