import { TicketIcon, TrendingUpIcon, UsersIcon, XCircleIcon } from 'lucide-react'
import dynamic from 'next/dynamic'
import { getLocale, getTranslations } from 'next-intl/server'

import { CabinetHeader } from '@/app/cabinet/_components/cabinet-header'
import { StatCard } from '@/app/cabinet/_components/stat-card'
import { Skeleton } from '@/components/ui/skeleton'
import { toChartTrend } from '@/helpers/analytics'
import { getCabinetSummary } from '@/server/api-client'

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
      <Skeleton className="h-80 rounded-xl lg:col-span-2" />
      <Skeleton className="h-80 rounded-xl" />
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
  // Anonymous visitors get the read-only demo scope from the API (ADR-010).
  // Every metric is aggregated in the Python API rather than loaded into
  // JS memory — the fill rate's seats come off the atomic-reserve
  // `bookedCount`/`capacity` columns, summed across the upcoming schedule.
  const [t, tcrumbs, locale, summaryEnvelope] = await Promise.all([
    getTranslations('Cabinet.analytics'),
    getTranslations('Cabinet.crumbs'),
    getLocale(),
    getCabinetSummary(),
  ])
  const summary = summaryEnvelope.analytics
  const overview = summaryEnvelope.overview

  // Zero-fill the 14-day API trend into the 7-day chart buckets.
  const trend = toChartTrend(summary.trend, locale)

  const fillRateValue =
    overview.upcomingSeatsOffered === 0
      ? null
      : Math.round((overview.upcomingSeatsBooked / overview.upcomingSeatsOffered) * 100)
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
            hint={t('upcomingSlotsCount', { count: overview.upcomingSlots })}
            icon={TrendingUpIcon}
          />
          <StatCard
            title={t('cancellations')}
            value={cancellationRate === null ? '—' : `${cancellationRate}%`}
            hint={t('bookingsInWindow', { count: summary.windowBookings })}
            icon={XCircleIcon}
          />
        </div>

        <AnalyticsCharts trend={trend} byService={summary.byService} />
      </div>
    </>
  )
}
