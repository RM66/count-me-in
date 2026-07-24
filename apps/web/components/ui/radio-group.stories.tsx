import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

const meta = {
  title: 'UI/RadioGroup',
  component: RadioGroup,
  tags: ['autodocs'],
} satisfies Meta<typeof RadioGroup>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <RadioGroup defaultValue="online" className="w-64">
      <div className="flex items-center gap-2">
        <RadioGroupItem value="online" id="online" />
        <Label htmlFor="online">Online</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="in-person" id="in-person" />
        <Label htmlFor="in-person">In person</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="hybrid" id="hybrid" disabled />
        <Label htmlFor="hybrid">Hybrid (unavailable)</Label>
      </div>
    </RadioGroup>
  ),
}
