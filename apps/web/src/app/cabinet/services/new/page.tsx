import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { CabinetHeader } from '@/app/cabinet/_components/cabinet-header'
import { ServiceForm } from '@/app/cabinet/services/_components/service-form'
import { getOrganizerProfile } from '@/server/api-client'

export default async function NewServicePage() {
  // The demo account cannot create services (ADR-010). The entry point is
  // disabled in the UI, but the route is still reachable by URL — bounce it.
  // The API's `isDemo` is the source of truth (anonymous visitors get the
  // demo profile).
  const [t, tcrumbs, profile] = await Promise.all([
    getTranslations('Cabinet.services'),
    getTranslations('Cabinet.crumbs'),
    getOrganizerProfile(),
  ])
  if (profile?.isDemo ?? true) {
    redirect('/cabinet/services')
  }

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
