import { TicketIcon, UsersIcon, TrendingUpIcon, XCircleIcon } from 'lucide-react'
import { CabinetHeader } from '@/app/cabinet/_components/cabinet-header'
import { StatCard } from '@/app/cabinet/_components/stat-card'
import { AnalyticsCharts } from '@/app/cabinet/analytics/_components/analytics-charts'

export default function AnalyticsPage() {
  return (
    <>
      <CabinetHeader
        crumbs={[{ label: 'Cabinet', href: '/cabinet' }, { label: 'Analytics' }]}
      />
      <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Track how your bookings are trending.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Total bookings" value="104" delta="+18%" hint="last 30 days" icon={TicketIcon} />
          <StatCard title="Seats sold" value="188" delta="+11%" hint="last 30 days" icon={UsersIcon} />
          <StatCard title="Avg. fill rate" value="74%" delta="+5%" hint="across all slots" icon={TrendingUpIcon} />
          <StatCard title="Cancellations" value="6%" delta="-2%" hint="of bookings" icon={XCircleIcon} />
        </div>

        <AnalyticsCharts />
      </div>
    </>
  )
}
