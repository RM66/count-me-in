import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const meta = {
  title: 'UI/Tabs',
  component: Tabs,
  tags: ['autodocs'],
} satisfies Meta<typeof Tabs>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Tabs defaultValue="upcoming" className="w-96">
      <TabsList>
        <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
        <TabsTrigger value="past">Past</TabsTrigger>
        <TabsTrigger value="cancelled">Cancelled</TabsTrigger>
      </TabsList>
      <TabsContent value="upcoming">Upcoming bookings will appear here.</TabsContent>
      <TabsContent value="past">Past bookings will appear here.</TabsContent>
      <TabsContent value="cancelled">Cancelled bookings will appear here.</TabsContent>
    </Tabs>
  ),
}

export const LineVariant: Story = {
  render: () => (
    <Tabs defaultValue="services" className="w-96">
      <TabsList variant="line">
        <TabsTrigger value="services">Services</TabsTrigger>
        <TabsTrigger value="slots">Slots</TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
      </TabsList>
      <TabsContent value="services">Manage your services.</TabsContent>
      <TabsContent value="slots">Manage time slots.</TabsContent>
      <TabsContent value="settings">Organizer settings.</TabsContent>
    </Tabs>
  ),
}

export const Vertical: Story = {
  render: () => (
    <Tabs defaultValue="profile" orientation="vertical" className="w-96">
      <TabsList>
        <TabsTrigger value="profile">Profile</TabsTrigger>
        <TabsTrigger value="notifications">Notifications</TabsTrigger>
      </TabsList>
      <TabsContent value="profile">Profile settings.</TabsContent>
      <TabsContent value="notifications">Notification preferences.</TabsContent>
    </Tabs>
  ),
}
