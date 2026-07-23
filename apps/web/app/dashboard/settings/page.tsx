import { DashboardHeader } from '@/components/dashboard/dashboard-header'
import { SettingsForm } from '@/components/dashboard/settings-form'

export default function SettingsPage() {
  return (
    <>
      <DashboardHeader
        crumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Settings' }]}
      />
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
