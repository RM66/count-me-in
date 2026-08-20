import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { CabinetHeader } from '@/app/cabinet/_components/cabinet-header'
import { ServiceForm } from '@/app/cabinet/services/_components/service-form'
import { isDemoSession } from '@/server/demo'

export default async function NewServicePage() {
  // The demo account cannot create services (ADR-010). The entry point is
  // disabled in the UI, but the route is still reachable by URL — bounce it.
  if (await isDemoSession()) {
    redirect('/cabinet/services')
  }

  const t = await getTranslations('Cabinet.services')
  const tcrumbs = await getTranslations('Cabinet.crumbs')

  return (
    <>
      <CabinetHeader
        crumbs={[
          { label: tcrumbs('cabinet'), href: '/cabinet' },
          { label: tcrumbs('services'), href: '/cabinet/services' },
          { label: tcrumbs('new') },
        ]}
      />
      <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('newTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('newSubtitle')}</p>
        </div>
        <ServiceForm />
      </div>
    </>
  )
}
