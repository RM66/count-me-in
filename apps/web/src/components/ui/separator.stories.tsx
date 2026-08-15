import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { Separator } from '@/components/ui/separator'

const meta = {
  title: 'UI/Separator',
  component: Separator,
  tags: ['autodocs'],
} satisfies Meta<typeof Separator>

export default meta
type Story = StoryObj<typeof meta>

export const Horizontal: Story = {
  render: () => (
    <div className="w-64">
      <p className="text-sm font-medium">CountMeIn</p>
      <p className="text-sm text-muted-foreground">Simple group bookings.</p>
      <Separator className="my-4" />
      <p className="text-sm">Content below the separator.</p>
    </div>
  ),
}

export const Vertical: Story = {
  render: () => (
    <div className="flex h-5 items-center gap-4 text-sm">
      <span>Services</span>
      <Separator orientation="vertical" />
      <span>Slots</span>
      <Separator orientation="vertical" />
      <span>Bookings</span>
    </div>
  ),
}
