import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { CalendarIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'

const meta = {
  title: 'UI/Empty',
  component: Empty,
  tags: ['autodocs'],
} satisfies Meta<typeof Empty>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CalendarIcon />
        </EmptyMedia>
        <EmptyTitle>No slots yet</EmptyTitle>
        <EmptyDescription>
          Create your first time slot so guests can start booking.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button>Create slot</Button>
      </EmptyContent>
    </Empty>
  ),
}
