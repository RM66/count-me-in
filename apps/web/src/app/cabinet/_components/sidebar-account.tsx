'use client'

import { ChevronsUpDownIcon, LogInIcon, LogOutIcon, UserIcon, UserPlusIcon } from 'lucide-react'
import Link from 'next/link'
import { signOut } from 'next-auth/react'
import { useTranslations } from 'next-intl'

import type { useCurrentOrganizer } from '@/api-client'
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
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { initials } from '@/helpers/name'

type SidebarAccountProps = {
  /** The cached profile — `undefined` while the query is still loading. */
  organizer: ReturnType<typeof useCurrentOrganizer>['data']
}

/**
 * The sidebar footer: the signed-in organizer's account menu, sign-up/log-in
 * CTAs inside the read-only demo cabinet (ADR-010 — the visitor has no
 * account, so a "Log out" there would be meaningless), or skeletons while the
 * profile query is in flight.
 */
export function SidebarAccount({ organizer }: SidebarAccountProps) {
  const t = useTranslations('Cabinet.sidebar')

  return (
    <SidebarFooter>
      <SidebarMenu>
        <SidebarMenuItem>
          {organizer?.isDemo ? (
            <div className="flex flex-col gap-2 p-1 group-data-[collapsible=icon]:hidden">
              <p className="px-1 text-xs text-muted-foreground">{t('demoNote')}</p>
              <Button size="sm" asChild>
                <Link href="/signup">
                  <UserPlusIcon data-icon="inline-start" />
                  {t('signUp')}
                </Link>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link href="/login">
                  <LogInIcon data-icon="inline-start" />
                  {t('logIn')}
                </Link>
              </Button>
            </div>
          ) : organizer ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
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
                  <ChevronsUpDownIcon className="ms-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" className="w-56">
                <DropdownMenuLabel>{t('myAccount')}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem asChild>
                    <Link href="/cabinet/settings">
                      <UserIcon />
                      {t('profile')}
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
                  {t('logOut')}
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
  )
}
