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

function toCalDate(iso: string): string {
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

export function AddToCalendar({
  title,
  startsAt,
  endsAt,
  location,
  variant = 'outline',
  className,
}: {
  title: string
  startsAt: string
  endsAt: string
  location?: string
  variant?: 'outline' | 'default' | 'secondary'
  className?: string
}) {
  const start = toCalDate(startsAt)
  const end = toCalDate(endsAt)
  const t = useTranslations('AddToCalendar')

  const googleUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(
    title,
  )}&dates=${start}/${end}${location ? `&location=${encodeURIComponent(location)}` : ''}`

  const downloadIcs = () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//CountMeIn//EN',
      'BEGIN:VEVENT',
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${title}`,
      location ? `LOCATION:${location}` : '',
      'END:VEVENT',
      'END:VCALENDAR',
    ]
      .filter(Boolean)
      .join('\r\n')

    const blob = new Blob([ics], { type: 'text/calendar' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${title.replace(/\s+/g, '-').toLowerCase()}.ics`
    a.click()
    URL.revokeObjectURL(url)
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
