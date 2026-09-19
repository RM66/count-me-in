import { fillRate } from '@repo/contracts'
import { TicketIcon, TrendingUpIcon, UsersIcon, XCircleIcon } from 'lucide-react'
import dynamic from 'next/dynamic'
import { getTranslations } from 'next-intl/server'

import { CabinetHeader } from '@/app/cabinet/_components/cabinet-header'
import { StatCard } from '@/app/cabinet/_components/stat-card'
import { getAnalyticsSummary } from '@/server/db/booking'
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

  // The booking-derived metrics are aggregated in Postgres (Phase 2.2) rather
  // than loaded into JS memory; slots are still needed for the fill rate,
  // which reads off the atomic-reserve `bookedCount` column.
  const [slots, summary] = await Promise.all([
    listSlots(organizerId),
    getAnalyticsSummary(organizerId),
  ])

  const now = Date.now()
  const upcoming = slots.filter((slot) => new Date(slot.startsAt).getTime() >= now)
  const fillRateValue = fillRate(upcoming)
  const totalBookingsDelta =
    summary.prevTotalBookings === 0
      ? null
      : (summary.totalBookings - summary.prevTotalBookings) / summary.prevTotalBookings
  const seatsSoldDelta =
    summary.prevSeatsSold === 0
      ? null
      : (summary.seatsSold - summary.prevSeatsSold) / summary.prevSeatsSold
  const cancellationRate =
    summary.windowBookings === 0
      ? null
      : Math.round((summary.cancelledInWindow / summary.windowBookings) * 100)

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
            delta={formatDelta(totalBookingsDelta)}
            hint={t('confirmedLast30')}
            icon={TicketIcon}
          />
          <StatCard
            title={t('seatsSold')}
            value={String(summary.seatsSold)}
            delta={formatDelta(seatsSoldDelta)}
            hint={t('confirmedLast30')}
            icon={UsersIcon}
          />
          <StatCard
            title={t('avgFillRate')}
            value={fillRateValue === null ? '—' : `${fillRateValue}%`}
            hint={t('upcomingSlotsCount', { count: upcoming.length })}
            icon={TrendingUpIcon}
          />
          <StatCard
            title={t('cancellations')}
            value={cancellationRate === null ? '—' : `${cancellationRate}%`}
            hint={t('bookingsInWindow', { count: summary.windowBookings })}
            icon={XCircleIcon}
          />
        </div>

        <AnalyticsCharts trend={summary.trend} byService={summary.byService} />
      </div>
    </>
  )
}
