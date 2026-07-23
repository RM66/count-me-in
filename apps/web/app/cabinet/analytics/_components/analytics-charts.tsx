'use client'

import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'

const bookingsOverTime = [
  { day: 'Mon', bookings: 8, seats: 14 },
  { day: 'Tue', bookings: 12, seats: 21 },
  { day: 'Wed', bookings: 9, seats: 16 },
  { day: 'Thu', bookings: 15, seats: 27 },
  { day: 'Fri', bookings: 18, seats: 33 },
  { day: 'Sat', bookings: 24, seats: 42 },
  { day: 'Sun', bookings: 20, seats: 36 },
]

const perService = [
  { service: 'Yoga', bookings: 42 },
  { service: 'Pottery', bookings: 28 },
  { service: 'Breathwork', bookings: 34 },
]

const trendConfig = {
  bookings: { label: 'Bookings', color: 'var(--chart-1)' },
  seats: { label: 'Seats', color: 'var(--chart-2)' },
} satisfies ChartConfig

const serviceConfig = {
  bookings: { label: 'Bookings', color: 'var(--chart-1)' },
} satisfies ChartConfig

export function AnalyticsCharts() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Bookings this week</CardTitle>
          <CardDescription>Confirmed bookings and seats sold per day.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={trendConfig} className="h-[320px] w-full">
            <AreaChart data={bookingsOverTime} margin={{ left: 4, right: 12, top: 8 }}>
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
          <CardTitle>By service</CardTitle>
          <CardDescription>Bookings in the last 30 days.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={serviceConfig} className="h-[320px] w-full">
            <BarChart data={perService} layout="vertical" margin={{ left: 4, right: 12 }}>
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
