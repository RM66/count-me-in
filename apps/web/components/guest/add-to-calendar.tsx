'use client'

import { CalendarPlus, Download, ExternalLink } from 'lucide-react'

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
}: {
  title: string
  startsAt: string
  endsAt: string
  location?: string
  variant?: 'outline' | 'default' | 'secondary'
}) {
  const start = toCalDate(startsAt)
  const end = toCalDate(endsAt)

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
        <Button variant={variant}>
          <CalendarPlus data-icon="inline-start" />
          Add to calendar
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <a href={googleUrl} target="_blank" rel="noreferrer">
              <ExternalLink data-icon="inline-start" />
              Google Calendar
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={downloadIcs}>
            <Download data-icon="inline-start" />
            Download .ics
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
