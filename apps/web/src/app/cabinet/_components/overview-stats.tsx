import type { CabinetOverviewRecord } from '@repo/contracts'
import { CalendarClockIcon, TicketIcon, TrendingUpIcon, UsersIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { StatCard } from '@/app/cabinet/_components/stat-card'

/**
 * The overview's four headline numbers. Seats and fill rate both describe the
 * *upcoming* schedule and come from the same bookedCount/capacity columns the
 * atomic reserve maintains (invariant 2 in docs/domain.md) — the summary
 * summed them across the whole upcoming schedule server-side, not just the
 * preview rows.
 */
export function OverviewStats({ overview }: { overview: CabinetOverviewRecord }) {
  const t = useTranslations('Cabinet.overview')

  const fillRateValue =
    overview.upcomingSeatsOffered === 0
      ? null
      : Math.round((overview.upcomingSeatsBooked / overview.upcomingSeatsOffered) * 100)

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatCard
        title={t('statConfirmed')}
        value={String(overview.confirmedBookings)}
        hint={t('last7Days', { count: overview.confirmedLast7Days })}
        icon={TicketIcon}
      />
      <StatCard
        title={t('statSeats')}
        value={String(overview.upcomingSeatsBooked)}
        hint={t('acrossUpcoming')}
        icon={UsersIcon}
      />
      <StatCard
        title={t('statSlots')}
        value={String(overview.upcomingSlots)}
        hint={t('next7Days', { count: overview.upcomingSlotsNext7Days })}
        icon={CalendarClockIcon}
      />
      <StatCard
        title={t('statFillRate')}
        value={fillRateValue === null ? '—' : `${fillRateValue}%`}
        hint={
          fillRateValue === null
            ? t('noUpcomingCapacity')
            : t('seatsTaken', {
                booked: overview.upcomingSeatsBooked,
                offered: overview.upcomingSeatsOffered,
              })
        }
        icon={TrendingUpIcon}
      />
    </div>
  )
}
