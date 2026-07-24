import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Bar, BarChart, CartesianGrid, XAxis } from 'recharts'

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'

const meta = {
  title: 'UI/Chart',
  component: ChartContainer,
  tags: ['autodocs'],
} satisfies Meta<typeof ChartContainer>

export default meta
type Story = StoryObj<typeof meta>

const chartData = [
  { day: 'Mon', bookings: 4, cancellations: 1 },
  { day: 'Tue', bookings: 7, cancellations: 0 },
  { day: 'Wed', bookings: 5, cancellations: 2 },
  { day: 'Thu', bookings: 9, cancellations: 1 },
  { day: 'Fri', bookings: 12, cancellations: 3 },
  { day: 'Sat', bookings: 18, cancellations: 2 },
  { day: 'Sun', bookings: 14, cancellations: 1 },
]

const chartConfig = {
  bookings: {
    label: 'Bookings',
    color: 'var(--chart-2)',
  },
  cancellations: {
    label: 'Cancellations',
    color: 'var(--chart-1)',
  },
} satisfies ChartConfig

export const BarChartExample: Story = {
  args: { config: chartConfig, children: <div /> },
  render: () => (
    <ChartContainer config={chartConfig} className="min-h-64 w-full max-w-xl">
      <BarChart accessibilityLayer data={chartData}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="day" tickLine={false} tickMargin={10} axisLine={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="bookings" fill="var(--color-bookings)" radius={4} />
        <Bar dataKey="cancellations" fill="var(--color-cancellations)" radius={4} />
      </BarChart>
    </ChartContainer>
  ),
}
