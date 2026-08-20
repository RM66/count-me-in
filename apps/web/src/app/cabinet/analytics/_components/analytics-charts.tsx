'use client'

import { useTranslations } from 'next-intl'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'

import type {
  AnalyticsServicePoint,
  AnalyticsTrendPoint,
} from '@/app/cabinet/analytics/compute-analytics'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'

export function AnalyticsCharts({
  trend,
  byService,
}: {
  trend: AnalyticsTrendPoint[]
  byService: AnalyticsServicePoint[]
}) {
  const t = useTranslations('Cabinet.analytics')

  // Chart legend/tooltip labels are user-visible copy too — built inside the
  // component so they follow the locale like the rest of the cards.
  const trendConfig: ChartConfig = {
    bookings: { label: t('bookingsLabel'), color: 'var(--chart-1)' },
    seats: { label: t('seatsLabel'), color: 'var(--chart-2)' },
  }

  const serviceConfig: ChartConfig = {
    bookings: { label: t('bookingsLabel'), color: 'var(--chart-1)' },
  }

  const hasTrend = trend.some((point) => point.bookings > 0 || point.seats > 0)
  const hasServices = byService.length > 0

  if (!hasTrend && !hasServices) {
    return (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('bookingsThisWeek')}</CardTitle>
            <CardDescription>{t('bookingsThisWeekHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="py-10 text-center text-sm text-muted-foreground">{t('noBookingsYet')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('byService')}</CardTitle>
            <CardDescription>{t('byServiceHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="py-10 text-center text-sm text-muted-foreground">{t('noBookings30')}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>{t('bookingsThisWeek')}</CardTitle>
          <CardDescription>{t('bookingsThisWeekHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer
            config={trendConfig}
            className="h-80 w-full"
            role="img"
            aria-label={t('trendAria')}
          >
            <AreaChart data={trend} margin={{ left: 4, right: 12, top: 8 }}>
              <defs>
                <linearGradient id="fillBookings" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-bookings)" stopOpacity={0.7} />
                  <stop offset="95%" stopColor="var(--color-bookings)" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="fillSeats" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-seats)" stopOpacity={0.5} />
                  <stop offset="95%" stopColor="var(--color-seats)" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis tickLine={false} axisLine={false} width={28} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Area
                dataKey="seats"
                type="monotone"
                fill="url(#fillSeats)"
                stroke="var(--color-seats)"
                strokeWidth={2}
              />
              <Area
                dataKey="bookings"
                type="monotone"
                fill="url(#fillBookings)"
                stroke="var(--color-bookings)"
                strokeWidth={2}
              />
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('byService')}</CardTitle>
          <CardDescription>{t('byServiceHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer
            config={serviceConfig}
            className="h-80 w-full"
            role="img"
            aria-label={t('serviceAria')}
          >
            <BarChart data={byService} layout="vertical" margin={{ left: 4, right: 12 }}>
              <CartesianGrid horizontal={false} />
              <XAxis type="number" tickLine={false} axisLine={false} />
              <YAxis
                type="category"
                dataKey="service"
                tickLine={false}
                axisLine={false}
                width={72}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="bookings" fill="var(--color-bookings)" radius={6} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  )
}
