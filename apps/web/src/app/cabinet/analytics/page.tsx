import { TicketIcon, TrendingUpIcon, UsersIcon, XCircleIcon } from 'lucide-react'
import dynamic from 'next/dynamic'
import { getTranslations } from 'next-intl/server'

import { CabinetHeader } from '@/app/cabinet/_components/cabinet-header'
import { StatCard } from '@/app/cabinet/_components/stat-card'
import { computeAnalytics } from '@/app/cabinet/analytics/compute-analytics'
import { listBookings } from '@/server/db/booking'
import { listServices } from '@/server/db/service'
import { listSlots } from '@/server/db/time-slot'
import { resolveCabinetOrganizerId } from '@/server/demo'

// recharts is a heavy client bundle; defer it so the page shell and stat cards
// paint before the chart chunk loads. The charts are the only consumer. The
// loaded module is a client component, so it renders on the client regardless.
const AnalyticsCharts = dynamic(
  () =>
    import('@/app/cabinet/analytics/_components/analytics-charts').then((m) => m.AnalyticsCharts),
  { loading: () => <ChartSkeleton /> },
)

function ChartSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="h-80 rounded-xl border bg-muted/30 lg:col-span-2" />
      <div className="h-80 rounded-xl border bg-muted/30" />
    </div>
  )
}

/**
 * Format a fractional delta as a signed percentage, e.g. `0.18` → "+18%".
 * Returns `undefined` when there is no previous window to compare against, so
 * `StatCard` omits the badge entirely instead of showing a misleading "+0%"
 * or a placeholder dash.
 */
function formatDelta(delta: number | null): string | undefined {
  if (delta === null) return undefined
  const pct = Math.round(delta * 100)
  return `${pct >= 0 ? '+' : ''}${pct}%`
}

export default async function AnalyticsPage() {
  // Anonymous visitors get the read-only demo organizer (ADR-010).
  const { organizerId } = await resolveCabinetOrganizerId()

  const t = await getTranslations('Cabinet.analytics')
  const tcrumbs = await getTranslations('Cabinet.crumbs')

  // Analytics reads the same three lists as the overview and bookings pages —
  // the cabinet's data wire is one shape, and `computeAnalytics` is a pure
  // function over those records (ADR-001). Slots are fetched in full rather
  // than `upcomingOnly` because a booking may sit on a past session and still
  // has to resolve Booking → TimeSlot → Service to name its service.
  const [services, slots, bookings] = await Promise.all([
    listServices(organizerId),
    listSlots(organizerId),
    listBookings(organizerId),
  ])

  const summary = computeAnalytics(bookings, slots, services)

  return (
    <>
      <CabinetHeader
        crumbs={[{ label: tcrumbs('cabinet'), href: '/cabinet' }, { label: tcrumbs('analytics') }]}
      />
      <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title={t('totalBookings')}
            value={String(summary.totalBookings)}
            delta={formatDelta(summary.totalBookingsDelta)}
            hint={t('confirmedLast30')}
            icon={TicketIcon}
          />
          <StatCard
            title={t('seatsSold')}
            value={String(summary.seatsSold)}
            delta={formatDelta(summary.seatsSoldDelta)}
            hint={t('confirmedLast30')}
            icon={UsersIcon}
          />
          <StatCard
            title={t('avgFillRate')}
            value={summary.fillRate === null ? '—' : `${summary.fillRate}%`}
            hint={t('upcomingSlotsCount', { count: summary.upcomingSlots })}
            icon={TrendingUpIcon}
          />
          <StatCard
            title={t('cancellations')}
            value={summary.cancellationRate === null ? '—' : `${summary.cancellationRate}%`}
            hint={t('bookingsInWindow', { count: summary.windowBookings })}
            icon={XCircleIcon}
          />
        </div>

        <AnalyticsCharts trend={summary.trend} byService={summary.byService} />
      </div>
    </>
  )
}
