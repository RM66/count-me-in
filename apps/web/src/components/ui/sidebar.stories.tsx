import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { CalendarIcon, HomeIcon, SettingsIcon, UsersIcon } from 'lucide-react'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { TooltipProvider } from './tooltip'

const meta: Meta<typeof Sidebar> = {
  title: 'UI/Sidebar',
  component: Sidebar,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => (
      <SidebarProvider>
        <TooltipProvider>
          <Story />
          <SidebarInset>
            <header className="flex h-12 items-center gap-2 border-b px-4">
              <SidebarTrigger />
              <span className="text-sm font-medium">Cabinet</span>
            </header>
            <div className="p-4 text-sm text-muted-foreground">Main content area.</div>
          </SidebarInset>
        </TooltipProvider>
      </SidebarProvider>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof meta>

const items = [
  { title: 'Dashboard', icon: HomeIcon, badge: undefined },
  { title: 'Slots', icon: CalendarIcon, badge: '12' },
  { title: 'Guests', icon: UsersIcon, badge: undefined },
  { title: 'Settings', icon: SettingsIcon, badge: undefined },
]

export const Default: Story = {
  render: (args) => (
    <Sidebar {...args}>
      <SidebarHeader>
        <span className="px-2 py-1.5 font-heading text-sm font-medium">CountMeIn</span>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Organizer</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton isActive={item.title === 'Dashboard'} tooltip={item.title}>
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                  {item.badge && <SidebarMenuBadge>{item.badge}</SidebarMenuBadge>}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <span className="px-2 py-1.5 text-xs text-muted-foreground">v0.1.0</span>
      </SidebarFooter>
    </Sidebar>
  ),
}

export const IconCollapsible: Story = {
  args: { collapsible: 'icon' },
  render: Default.render,
}
