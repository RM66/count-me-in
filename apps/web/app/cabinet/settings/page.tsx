import { CabinetHeader } from '@/app/cabinet/_components/cabinet-header'
import { SettingsForm } from '@/app/cabinet/settings/_components/settings-form'

export default function SettingsPage() {
  return (
    <>
      <CabinetHeader crumbs={[{ label: 'Cabinet', href: '/cabinet' }, { label: 'Settings' }]} />
      <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Manage your profile, public page, and notifications.
          </p>
        </div>
        <SettingsForm />
      </div>
    </>
  )
}
