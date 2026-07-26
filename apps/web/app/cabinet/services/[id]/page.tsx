import { ExternalLinkIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { CabinetHeader } from '@/app/cabinet/_components/cabinet-header'
import { ServiceForm } from '@/app/cabinet/services/_components/service-form'
import { Button } from '@/components/ui/button'
import { getService, organizer } from '@/lib/mock-data'

export default async function EditServicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const service = getService(id)
  if (!service) notFound()

  return (
    <>
      <CabinetHeader
        crumbs={[
          { label: 'Cabinet', href: '/cabinet' },
          { label: 'Services', href: '/cabinet/services' },
          { label: service.title },
        ]}
        action={
          <Button variant="outline" size="sm" asChild>
            <Link href={`/${organizer.slug}/${service.id}`} target="_blank">
              <ExternalLinkIcon data-icon="inline-start" />
              Preview
            </Link>
          </Button>
        }
      />
      <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-balance">{service.title}</h1>
          <p className="text-sm text-muted-foreground">Edit service details and options.</p>
        </div>
        <ServiceForm service={service} />
      </div>
    </>
  )
}
