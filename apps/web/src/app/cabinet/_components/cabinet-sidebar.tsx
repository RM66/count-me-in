'use client'

import {
  //BarChart3Icon,
  CalendarClockIcon,
  CalendarDaysIcon,
  ChevronsUpDownIcon,
  ExternalLinkIcon,
  LayoutDashboardIcon,
  LogInIcon,
  LogOutIcon,
  MailIcon,
  SettingsIcon,
  SparklesIcon,
  TicketIcon,
  UserIcon,
  UserPlusIcon,
} from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'

import { useCurrentOrganizer } from '@/api-client'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
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
import { Skeleton } from '@/components/ui/skeleton'
import { SUPPORT_EMAIL } from '@/constants/site'
import { initials } from '@/helpers/name'
import { cn } from '@/lib/utils'

const nav = [
  { title: 'Overview', href: '/cabinet', icon: LayoutDashboardIcon },
  { title: 'Services', href: '/cabinet/services', icon: SparklesIcon },
  { title: 'Slots', href: '/cabinet/slots', icon: CalendarClockIcon },
  { title: 'Calendar', href: '/cabinet/calendar', icon: CalendarDaysIcon },
  { title: 'Bookings', href: '/cabinet/bookings', icon: TicketIcon },
  // TODO: { title: 'Analytics', href: '/cabinet/analytics', icon: BarChart3Icon },
  { title: 'Settings', href: '/cabinet/settings', icon: SettingsIcon },
]

export function CabinetSidebar() {
  const pathname = usePathname()
  const { data: organizer } = useCurrentOrganizer()

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

        {organizer && (
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
        )}

        <SidebarGroup>
          <SidebarGroupLabel>Support</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Contact support">
                  <a href={`mailto:${SUPPORT_EMAIL}`}>
                    <MailIcon />
                    <span>Contact</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            {organizer?.isDemo ? (
              // Read-only demo (ADR-010): the visitor has no account, so offer
              // both entry points instead of a meaningless "Log out".
              <div className="flex flex-col gap-2 p-1 group-data-[collapsible=icon]:hidden">
                <p className="px-1 text-xs text-muted-foreground">
                  You&apos;re viewing a demo cabinet.
                </p>
                <Button size="sm" asChild>
                  <Link href="/signup">
                    <UserPlusIcon data-icon="inline-start" />
                    Sign up
                  </Link>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link href="/login">
                    <LogInIcon data-icon="inline-start" />
                    Log in
                  </Link>
                </Button>
              </div>
            ) : organizer ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton
                    size="lg"
                    className={cn(
                      'data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground',
                    )}
                  >
                    <Avatar className="size-8 rounded-md">
                      {organizer.photoUrl && (
                        <AvatarImage src={organizer.photoUrl} sizes="2rem" alt={organizer.name} />
                      )}
                      <AvatarFallback className="rounded-md">
                        {initials(organizer.name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="truncate font-medium">{organizer.name}</span>
                    {/* <div className="flex flex-col gap-0.5 leading-none">
                      <span className="truncate font-medium">{organizer.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        TODO: Info about subscription
                      </span>
                    </div> */}
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
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => {
                      // Must actually clear the session: linking to /login only
                      // navigated, leaving the organizer signed in.
                      void signOut({ redirectTo: '/' })
                    }}
                  >
                    <LogOutIcon />
                    Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <SidebarMenuButton size="lg" disabled>
                <Skeleton className="size-8 rounded-md" />
                <div className="flex flex-1 flex-col gap-1">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-3 w-32" />
                </div>
              </SidebarMenuButton>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
