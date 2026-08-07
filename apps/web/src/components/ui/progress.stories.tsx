import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { Progress } from '@/components/ui/progress'

const meta: Meta<typeof Progress> = {
  title: 'UI/Progress',
  component: Progress,
  tags: ['autodocs'],
  args: {
    value: 40,
  },
  argTypes: {
    value: { control: { type: 'range', min: 0, max: 100 } },
  },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Full: Story = {
  args: { value: 100 },
}

export const CapacityExample: Story = {
  render: () => (
    <div className="grid w-80 gap-2">
      <div className="flex justify-between text-sm">
        <span>Booked</span>
        <span className="text-muted-foreground">7 / 10</span>
      </div>
      <Progress value={70} />
    </div>
  ),
}
