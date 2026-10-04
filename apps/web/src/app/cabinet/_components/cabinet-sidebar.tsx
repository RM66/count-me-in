'use client'

import {
  BarChart3Icon,
  CalendarClockIcon,
  CalendarDaysIcon,
  ExternalLinkIcon,
  GlobeIcon,
  LayoutDashboardIcon,
  MailIcon,
  SettingsIcon,
  SparklesIcon,
  TicketIcon,
} from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'

import { useCurrentOrganizer } from '@/api-client'
import { LanguageSwitcher } from '@/components/language-switcher'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'
import { SUPPORT_EMAIL } from '@/constants/site'
import { SidebarAccount } from './sidebar-account'

export function CabinetSidebar() {
  const pathname = usePathname()
  const { data: organizer } = useCurrentOrganizer()
  const locale = useLocale()
  const t = useTranslations('Cabinet.sidebar')

  const nav = [
    { title: t('nav.overview'), href: '/cabinet', icon: LayoutDashboardIcon },
    { title: t('nav.services'), href: '/cabinet/services', icon: SparklesIcon },
    { title: t('nav.slots'), href: '/cabinet/slots', icon: CalendarClockIcon },
    { title: t('nav.calendar'), href: '/cabinet/calendar', icon: CalendarDaysIcon },
    { title: t('nav.bookings'), href: '/cabinet/bookings', icon: TicketIcon },
    { title: t('nav.analytics'), href: '/cabinet/analytics', icon: BarChart3Icon },
    { title: t('nav.settings'), href: '/cabinet/settings', icon: SettingsIcon },
  ]

  return (
    <Sidebar side={locale === 'ar' ? 'right' : 'left'}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/cabinet">
                <Image src="/logo.svg" alt="" width={32} height={32} className="size-8" />
                <div className="flex flex-col gap-0.5 leading-none">
                  <span className="font-semibold">CountMeIn</span>
                  <span className="text-xs text-muted-foreground">{t('subtitle')}</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t('manage')}</SidebarGroupLabel>
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
            <SidebarGroupLabel>{t('public')}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild tooltip={t('viewPublicPage')}>
                    <Link href={`/${organizer.slug}`} target="_blank">
                      <ExternalLinkIcon />
                      <span>{t('viewPublicPage')}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        <SidebarGroup>
          <SidebarGroupLabel>{t('support')}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip={t('contact')}>
                  <a href={`mailto:${SUPPORT_EMAIL}`}>
                    <MailIcon />
                    <span>{t('contact')}</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>{t('language')}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <LanguageSwitcher
                  trigger={(active) => (
                    <SidebarMenuButton tooltip={t('language')}>
                      <GlobeIcon />
                      <span>{active.label}</span>
                    </SidebarMenuButton>
                  )}
                />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarAccount organizer={organizer} />
      <SidebarRail />
    </Sidebar>
  )
}
