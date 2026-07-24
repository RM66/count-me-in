import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

const meta: Meta<typeof Textarea> = {
  title: 'UI/Textarea',
  component: Textarea,
  tags: ['autodocs'],
  args: {
    placeholder: 'Describe your service…',
    disabled: false,
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

export const WithLabel: Story = {
  render: () => (
    <div className="grid gap-2">
      <Label htmlFor="description">Description</Label>
      <Textarea id="description" placeholder="Tell guests what to expect" />
    </div>
  ),
}

export const Invalid: Story = {
  args: { 'aria-invalid': true },
}

export const Disabled: Story = {
  args: { disabled: true },
}
