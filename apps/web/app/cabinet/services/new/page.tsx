import { CabinetHeader } from '@/app/cabinet/_components/cabinet-header'
import { ServiceForm } from '@/app/cabinet/services/_components/service-form'

export default function NewServicePage() {
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
