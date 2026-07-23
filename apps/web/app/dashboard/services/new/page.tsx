import { DashboardHeader } from '@/components/dashboard/dashboard-header'
import { ServiceForm } from '@/components/dashboard/service-form'

export default function NewServicePage() {
  return (
    <>
      <DashboardHeader
        crumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Services', href: '/dashboard/services' },
          { label: 'New' },
        ]}
      />
      <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">New service</h1>
          <p className="text-sm text-muted-foreground">
            Create an experience guests can book.
          </p>
        </div>
        <ServiceForm />
      </div>
    </>
  )
}
