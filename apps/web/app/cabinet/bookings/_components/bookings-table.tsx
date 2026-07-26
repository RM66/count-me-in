'use client'

import { PhoneIcon, SearchIcon, SendIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  bookings as allBookings,
  formatDateTime,
  getBookingService,
  getSlot,
  type Booking,
} from '@/lib/mock-data'

function initials(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
}

export function BookingsTable() {
  const [filter, setFilter] = useState<'all' | 'confirmed' | 'cancelled'>('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Booking | null>(null)

  const filtered = allBookings.filter((b) => {
    const matchesFilter = filter === 'all' || b.status === filter
    const matchesQuery =
      query.trim() === '' ||
      b.guestName.toLowerCase().includes(query.toLowerCase()) ||
      b.guestPhone.includes(query)
    return matchesFilter && matchesQuery
  })

  const selectedService = selected ? getBookingService(selected) : undefined
  const selectedSlot = selected ? getSlot(selected.timeSlotId) : undefined

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <ToggleGroup
          type="single"
          value={filter}
          onValueChange={(v) => v && setFilter(v as typeof filter)}
          variant="outline"
        >
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="confirmed">Confirmed</ToggleGroupItem>
          <ToggleGroupItem value="cancelled">Cancelled</ToggleGroupItem>
        </ToggleGroup>
        <div className="relative w-full sm:max-w-xs">
          <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or phone"
            className="pl-9"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchIcon />
            </EmptyMedia>
            <EmptyTitle>No bookings found</EmptyTitle>
            <EmptyDescription>Try adjusting your filters or search.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Guest</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>When</TableHead>
                <TableHead>Seats</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((b) => {
                const svc = getBookingService(b)
                const slot = getSlot(b.timeSlotId)
                return (
                  <TableRow key={b.id} className="cursor-pointer" onClick={() => setSelected(b)}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="size-8">
                          <AvatarFallback>{initials(b.guestName)}</AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col">
                          <span className="font-medium">{b.guestName}</span>
                          <span className="text-xs text-muted-foreground">{b.guestPhone}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{svc?.title}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {slot ? formatDateTime(slot.startsAt) : '—'}
                    </TableCell>
                    <TableCell>{b.seats}</TableCell>
                    <TableCell>
                      <Badge variant={b.status === 'confirmed' ? 'default' : 'secondary'}>
                        {b.status === 'confirmed' ? 'Confirmed' : 'Cancelled'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Sheet open={Boolean(selected)} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="flex flex-col">
          <SheetHeader>
            <SheetTitle>Booking details</SheetTitle>
            <SheetDescription>Reference {selected?.id}</SheetDescription>
          </SheetHeader>
          {selected && (
            <div className="flex flex-1 flex-col gap-5 overflow-auto px-4">
              <div className="flex items-center gap-3">
                <Avatar className="size-11">
                  <AvatarFallback>{initials(selected.guestName)}</AvatarFallback>
                </Avatar>
                <div className="flex flex-col">
                  <span className="font-medium">{selected.guestName}</span>
                  <span className="text-sm text-muted-foreground">{selected.guestPhone}</span>
                </div>
                <Badge
                  className="ml-auto"
                  variant={selected.status === 'confirmed' ? 'default' : 'secondary'}
                >
                  {selected.status === 'confirmed' ? 'Confirmed' : 'Cancelled'}
                </Badge>
              </div>

              <Separator />

              <dl className="grid grid-cols-1 gap-3 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Service</dt>
                  <dd className="text-right font-medium">{selectedService?.title}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">When</dt>
                  <dd className="text-right font-medium">
                    {selectedSlot ? formatDateTime(selectedSlot.startsAt) : '—'}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Seats</dt>
                  <dd className="text-right font-medium">{selected.seats}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Messenger</dt>
                  <dd className="text-right font-medium capitalize">{selected.messenger}</dd>
                </div>
                {selected.selectedOptions && selected.selectedOptions.length > 0 && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Options</dt>
                    <dd className="flex flex-wrap justify-end gap-1">
                      {selected.selectedOptions.map((o) => (
                        <Badge key={o} variant="outline">
                          {o}
                        </Badge>
                      ))}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          )}
          <SheetFooter>
            <Button
              onClick={() =>
                toast.success('Reminder sent', {
                  description: 'This is a mockup — no message was sent.',
                })
              }
            >
              <SendIcon data-icon="inline-start" />
              Send reminder
            </Button>
            <Button
              variant="outline"
              onClick={() => toast('Calling guest', { description: 'This is a mockup.' })}
            >
              <PhoneIcon data-icon="inline-start" />
              Call guest
            </Button>
            {selected?.status === 'confirmed' && (
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => toast('Cancel booking?', { description: 'This is a mockup.' })}
              >
                <XIcon data-icon="inline-start" />
                Cancel booking
              </Button>
            )}
            <SheetClose asChild>
              <Button variant="ghost">Close</Button>
            </SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  )
}
