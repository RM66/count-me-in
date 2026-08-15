import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { MoreHorizontalIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

const meta = {
  title: 'UI/Card',
  component: Card,
  tags: ['autodocs'],
  args: {
    size: 'default',
  },
  argTypes: {
    size: {
      control: 'select',
      options: ['default', 'sm'],
    },
  },
} satisfies Meta<typeof Card>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <Card {...args} className="w-96">
      <CardHeader>
        <CardTitle>Yoga class</CardTitle>
        <CardDescription>Saturday, 10:00 — 4 of 10 spots left</CardDescription>
        <CardAction>
          <Button variant="ghost" size="icon-sm" aria-label="More">
            <MoreHorizontalIcon />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        A relaxed group session for all levels. Bring your own mat; water is provided.
      </CardContent>
      <CardFooter className="gap-2">
        <Button>Book a spot</Button>
        <Button variant="outline">Details</Button>
      </CardFooter>
    </Card>
  ),
}

export const Small: Story = {
  render: () => (
    <Card size="sm" className="w-80">
      <CardHeader>
        <CardTitle>Small card</CardTitle>
        <CardDescription>Compact spacing variant</CardDescription>
      </CardHeader>
      <CardContent>Uses the sm size with tighter paddings.</CardContent>
    </Card>
  ),
}
