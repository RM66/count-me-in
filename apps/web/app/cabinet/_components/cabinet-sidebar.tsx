'use client'

import {
  BarChart3Icon,
  CalendarClockIcon,
  ChevronsUpDownIcon,
  ExternalLinkIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  SettingsIcon,
  SparklesIcon,
  TicketIcon,
  UserIcon,
} from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'
import { organizer } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

const nav = [
  { title: 'Overview', href: '/cabinet', icon: LayoutDashboardIcon },
  { title: 'Services', href: '/cabinet/services', icon: SparklesIcon },
  { title: 'Slots', href: '/cabinet/slots', icon: CalendarClockIcon },
  { title: 'Bookings', href: '/cabinet/bookings', icon: TicketIcon },
  { title: 'Analytics', href: '/cabinet/analytics', icon: BarChart3Icon },
  { title: 'Settings', href: '/cabinet/settings', icon: SettingsIcon },
]

export function CabinetSidebar() {
  const pathname = usePathname()

  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/cabinet">
                <Image src="/logo.svg" alt="" width={32} height={32} className="size-8" />
                <div className="flex flex-col gap-0.5 leading-none">
                  <span className="font-semibold">CountMeIn</span>
                  <span className="text-xs text-muted-foreground">Organizer</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Manage</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {nav.map((item) => {
                const active =
                  item.href === '/cabinet'
                    ? pathname === '/cabinet'
                    : pathname.startsWith(item.href)
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                      <Link href={item.href}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Public</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="View public page">
                  <Link href={`/${organizer.slug}`} target="_blank">
                    <ExternalLinkIcon />
                    <span>View public page</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className={cn(
                    'data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground',
                  )}
                >
                  <Avatar className="size-8 rounded-md">
                    <AvatarImage
                      src={organizer.photoUrl || '/placeholder.svg'}
                      sizes="2rem"
                      alt={organizer.name}
                    />
                    <AvatarFallback className="rounded-md">SL</AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col gap-0.5 leading-none">
                    <span className="truncate font-medium">{organizer.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {organizer.phone}
                    </span>
                  </div>
                  <ChevronsUpDownIcon className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" className="w-56">
                <DropdownMenuLabel>My account</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem asChild>
                    <Link href="/cabinet/settings">
                      <UserIcon />
                      Profile
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/cabinet/settings">
                      <SettingsIcon />
                      Settings
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/login">
                    <LogOutIcon />
                    Log out
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
