import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'

const meta: Meta<typeof Toaster> = {
  title: 'UI/Sonner',
  component: Toaster,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <>
        <Story />
        <Toaster />
      </>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      <Button variant="outline" onClick={() => toast('New booking: Anna K., Sat 10:00')}>
        Default
      </Button>
      <Button variant="outline" onClick={() => toast.success('Booking confirmed')}>
        Success
      </Button>
      <Button variant="outline" onClick={() => toast.warning('Slot is almost full')}>
        Warning
      </Button>
      <Button variant="outline" onClick={() => toast.error('Failed to save changes')}>
        Error
      </Button>
      <Button
        variant="outline"
        onClick={() =>
          toast('Booking cancelled', {
            description: 'Sat 10:00 · Yoga class',
            action: { label: 'Undo', onClick: () => {} },
          })
        }
      >
        With action
      </Button>
    </div>
  ),
}
