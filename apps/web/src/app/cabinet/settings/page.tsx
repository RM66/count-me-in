import { getTranslations } from 'next-intl/server'

import { CabinetHeader } from '@/app/cabinet/_components/cabinet-header'
import { SettingsForm } from '@/app/cabinet/settings/_components/settings-form'

export default async function SettingsPage() {
  const t = await getTranslations('Cabinet.settings')
  const tcrumbs = await getTranslations('Cabinet.crumbs')

  return (
    <>
      <CabinetHeader
        crumbs={[{ label: tcrumbs('cabinet'), href: '/cabinet' }, { label: tcrumbs('settings') }]}
      />
      <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        </div>
        <SettingsForm />
      </div>
    </>
  )
}
