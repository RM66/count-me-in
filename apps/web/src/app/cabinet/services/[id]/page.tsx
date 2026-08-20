import { db, organizers } from '@repo/db'
import { eq } from 'drizzle-orm'
import { ExternalLinkIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { CabinetHeader } from '@/app/cabinet/_components/cabinet-header'
import { ServiceForm } from '@/app/cabinet/services/_components/service-form'
import { Button } from '@/components/ui/button'
import { getOwnedService } from '@/server/db/service'
import { resolveCabinetOrganizerId } from '@/server/demo'

export default async function EditServicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const tcrumbs = await getTranslations('Cabinet.crumbs')
  const tc = await getTranslations('Cabinet.common')
  const t = await getTranslations('Cabinet.services')

  // `/cabinet` is open to anonymous visitors, who see the demo (ADR-010).
  const { organizerId } = await resolveCabinetOrganizerId()

  // Scoped to the owner: another organizer's id is a 404, never a peek.
  const service = await getOwnedService(organizerId, id)
  if (!service) notFound()

  const [organizer] = await db
    .select({ slug: organizers.slug })
    .from(organizers)
    .where(eq(organizers.id, organizerId))
    .limit(1)

  return (
    <>
      <CabinetHeader
        crumbs={[
          { label: tcrumbs('cabinet'), href: '/cabinet' },
          { label: tcrumbs('services'), href: '/cabinet/services' },
          { label: service.title },
        ]}
        action={
          organizer && (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/${organizer.slug}/${service.id}`} target="_blank">
                <ExternalLinkIcon data-icon="inline-start" />
                {tc('preview')}
              </Link>
            </Button>
          )
        }
      />
      <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-balance">{service.title}</h1>
          <p className="text-sm text-muted-foreground">{t('editSubtitle')}</p>
        </div>
        <ServiceForm service={service} />
      </div>
    </>
  )
}
