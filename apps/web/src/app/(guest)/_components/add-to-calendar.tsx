'use client'

import { CalendarPlus, Download, ExternalLink } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { buildIcs, icsFilename, toIcsDate } from '@/helpers/calendar'

export function AddToCalendar({
  uid,
  title,
  startsAt,
  endsAt,
  location,
  variant = 'outline',
  className,
}: {
  /** Stable event id (the booking id) — RFC 5545 requires UID. */
  uid: string
  title: string
  startsAt: string
  endsAt: string
  location?: string
  variant?: 'outline' | 'default' | 'secondary'
  className?: string
}) {
  const start = toIcsDate(new Date(startsAt))
  const end = toIcsDate(new Date(endsAt))
  const t = useTranslations('AddToCalendar')

  const googleUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(
    title,
  )}&dates=${start}/${end}${location ? `&location=${encodeURIComponent(location)}` : ''}`

  const downloadIcs = () => {
    const ics = buildIcs({ uid, title, startsAt, endsAt, location })
    const blob = new Blob([ics], { type: 'text/calendar' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = icsFilename(title)
    a.click()
    // Revoke on the next task — a synchronous revoke can abort the
    // download in Firefox/Safari before the browser reads the blob.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} className={className}>
          <CalendarPlus data-icon="inline-start" />
          {t('addToCalendar')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <a href={googleUrl} target="_blank" rel="noreferrer">
              <ExternalLink data-icon="inline-start" />
              {t('googleCalendar')}
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={downloadIcs}>
            <Download data-icon="inline-start" />
            {t('downloadIcs')}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
