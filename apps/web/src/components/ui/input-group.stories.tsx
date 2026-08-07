import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { SearchIcon, SendIcon } from 'lucide-react'

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from '@/components/ui/input-group'

const meta: Meta<typeof InputGroup> = {
  title: 'UI/InputGroup',
  component: InputGroup,
  tags: ['autodocs'],
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

export const WithIcon: Story = {
  render: () => (
    <InputGroup>
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput placeholder="Search bookings…" />
    </InputGroup>
  ),
}

export const WithPrefixText: Story = {
  render: () => (
    <InputGroup>
      <InputGroupAddon>
        <InputGroupText>countmein.group/</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput placeholder="your-slug" />
    </InputGroup>
  ),
}

export const WithButton: Story = {
  render: () => (
    <InputGroup>
      <InputGroupInput placeholder="Invite by phone…" />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" aria-label="Send">
          <SendIcon />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
}

export const WithTextarea: Story = {
  render: () => (
    <InputGroup>
      <InputGroupTextarea placeholder="Message to guests…" />
      <InputGroupAddon align="block-end">
        <InputGroupButton>Send</InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
}
