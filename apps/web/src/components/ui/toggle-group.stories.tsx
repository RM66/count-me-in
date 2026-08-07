import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { AlignCenterIcon, AlignLeftIcon, AlignRightIcon } from 'lucide-react'

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

const meta = {
  title: 'UI/ToggleGroup',
  component: ToggleGroup,
  tags: ['autodocs'],
} satisfies Meta<typeof ToggleGroup>

export default meta
type Story = StoryObj<typeof meta>

export const Single: Story = {
  args: { type: 'single' },
  render: () => (
    <ToggleGroup type="single" defaultValue="left" variant="outline">
      <ToggleGroupItem value="left" aria-label="Align left">
        <AlignLeftIcon />
      </ToggleGroupItem>
      <ToggleGroupItem value="center" aria-label="Align center">
        <AlignCenterIcon />
      </ToggleGroupItem>
      <ToggleGroupItem value="right" aria-label="Align right">
        <AlignRightIcon />
      </ToggleGroupItem>
    </ToggleGroup>
  ),
}

export const Multiple: Story = {
  args: { type: 'multiple' },
  render: () => (
    <ToggleGroup type="multiple" defaultValue={['mon', 'wed']}>
      <ToggleGroupItem value="mon">Mon</ToggleGroupItem>
      <ToggleGroupItem value="tue">Tue</ToggleGroupItem>
      <ToggleGroupItem value="wed">Wed</ToggleGroupItem>
      <ToggleGroupItem value="thu">Thu</ToggleGroupItem>
      <ToggleGroupItem value="fri">Fri</ToggleGroupItem>
    </ToggleGroup>
  ),
}

export const Joined: Story = {
  args: { type: 'single' },
  render: () => (
    <ToggleGroup type="single" defaultValue="week" variant="outline" spacing={0}>
      <ToggleGroupItem value="day">Day</ToggleGroupItem>
      <ToggleGroupItem value="week">Week</ToggleGroupItem>
      <ToggleGroupItem value="month">Month</ToggleGroupItem>
    </ToggleGroup>
  ),
}
