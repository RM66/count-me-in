'use client'

import type { ServiceRecord, SlotFill, TimeSlotRecord } from '@repo/api-contracts'
import {
  fillLabel,
  instantToWallClockInputs,
  seatsLeft,
  slotPrice,
  wallClockToInstant,
} from '@repo/api-contracts'
import { CalendarIcon, CalendarPlusIcon, MoreHorizontalIcon, PlusIcon, XIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useDeleteSlot } from '@/lib/api'
import { formatDate, formatTime } from '@/lib/helpers/date'
import type { SlotDialogMode } from './slot-dialog'
import { SlotDialog } from './slot-dialog'

const FILL_BADGE: Record<
  SlotFill,
  { label: string; variant: 'secondary' | 'outline' | 'default' }
> = {
  open: { label: 'Open', variant: 'outline' },
  filling: { label: 'Filling up', variant: 'default' },
  full: { label: 'Full', variant: 'secondary' },
}

/** What the dialog is currently doing, or `null` when it is closed. */
type DialogState = { mode: SlotDialogMode; slot?: TimeSlotRecord } | null

type SlotsTableProps = {
  slots: TimeSlotRecord[]
  services: ServiceRecord[]
  /** Organizer timezone — slots are stored as instants, shown as local time. */
  timezone: string
  /** "Now" as the server saw it, so the upcoming/past split cannot mismatch on hydration. */
  nowIso: string
  /** Show only this service's slots. Comes from `?service=` — already validated by the page. */
  activeServiceId?: string
  /** Read-only demo account (ADR-010). */
  isReadOnly: boolean
}

/**
 * The cabinet slot schedule: a live table plus its create / edit / duplicate /
 * delete affordances.
 *
 * A client component because every action here is interactive, but the **data
 * is passed in** — the page is a server component that reads Postgres directly,
 * the same split the services list uses. Writes go through the mutation hooks
 * and finish with `router.refresh()`, so the server render is the single source
 * of truth for what the table shows.
 */
export function SlotsTable({
  slots,
  services,
  timezone,
  nowIso,
  activeServiceId,
  isReadOnly,
}: SlotsTableProps) {
  const router = useRouter()
  const [dialog, setDialog] = useState<DialogState>(null)
  const [pendingDelete, setPendingDelete] = useState<TimeSlotRecord | null>(null)
  const [showPast, setShowPast] = useState(false)
  /** `YYYY-MM-DD` in the organizer's timezone, or `''` for "any day". */
  const [day, setDay] = useState('')
  const [isDayPickerOpen, setDayPickerOpen] = useState(false)

  const servicesById = new Map(services.map((service) => [service.id, service]))
  const activeService = activeServiceId ? servicesById.get(activeServiceId) : undefined

  /**
   * The calendar day a slot falls on, **as the organizer sees it**.
   *
   * `startsAt` is an instant, so slicing the ISO string would group by UTC day
   * and misfile every evening session for an organizer east of Greenwich.
   */
  const dayOf = (slot: TimeSlotRecord) => instantToWallClockInputs(slot.startsAt, timezone).date

  // Service filter first, so the Upcoming/Past counts describe what the
  // organizer is actually looking at rather than the whole schedule.
  const scopedByService = activeServiceId
    ? slots.filter((slot) => slot.serviceId === activeServiceId)
    : slots
  const scoped = scopedByService.filter((slot) => day === '' || dayOf(slot) === day)

  // Past sessions stay reachable behind a toggle rather than being dropped: a
  // slot saved with a stale date would otherwise just never appear, which
  // reads as "the save failed".
  const upcoming = scoped.filter((slot) => slot.startsAt >= nowIso)
  const past = scoped.filter((slot) => slot.startsAt < nowIso)
  const visible = showPast ? past : upcoming

  /**
   * Bridge between the two date worlds on this page.
   *
   * A day key is a *label* in the organizer's timezone; `DayPicker` works in
   * plain local `Date`s. Converting a key with `new Date(key)` would parse it
   * as UTC midnight and shift the highlight a day west of Greenwich, so the
   * parts are handed to the local constructor instead — the calendar square
   * for "the 2nd" is the same square whatever the browser's zone.
   */
  const dayKeyToDate = (key: string) =>
    new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)))

  const toDayKey = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
      date.getDate(),
    ).padStart(2, '0')}`

  /**
   * Which days to mark in the picker — the reason it exists rather than the
   * native control, which cannot say anything about a day's contents.
   *
   * Marks follow the **service filter**: while scoped to one service, the
   * calendar answers "when does *this* run", not "when does anything run".
   */
  const upcomingDates = [
    ...new Set(scopedByService.filter((slot) => slot.startsAt >= nowIso).map(dayOf)),
  ].map(dayKeyToDate)

  // A day counts as past only if nothing upcoming shares it, so a day holding
  // both is marked as upcoming — the actionable state wins.
  const upcomingKeys = new Set(scopedByService.filter((slot) => slot.startsAt >= nowIso).map(dayOf))
  const pastDates = [
    ...new Set(
      scopedByService
        .filter((slot) => slot.startsAt < nowIso)
        .map(dayOf)
        .filter((key) => !upcomingKeys.has(key)),
    ),
  ].map(dayKeyToDate)

  const selectedDate = day ? dayKeyToDate(day) : undefined

  /**
   * Which month to open on: the selected day, else the next session, else now.
   *
   * Deliberately *not* the earliest scheduled date — that is the oldest past
   * session, so the calendar would open on a bygone month with none of the
   * upcoming marks in view.
   */
  const firstUpcoming = [...upcomingDates].sort((a, b) => a.getTime() - b.getTime())[0]
  const defaultMonth = selectedDate ?? firstUpcoming ?? new Date(nowIso)

  /**
   * Picking a day also switches Upcoming/Past when the chosen day only has
   * sessions on the other side of "now" — otherwise selecting a past date
   * lands on an empty "Upcoming" tab and looks like the filter found nothing.
   */
  const selectDay = (next: string) => {
    setDay(next)
    if (next === '') return

    const onDay = scopedByService.filter((slot) => dayOf(slot) === next)

    if (onDay.length === 0) return
    setShowPast(onDay.every((slot) => slot.startsAt < nowIso))
  }

  /** Label for the active-day chip: "Tue, Jul 22" rather than the raw value. */
  const dayLabel = day
    ? formatDate(
        wallClockToInstant(
          {
            year: Number(day.slice(0, 4)),
            month: Number(day.slice(5, 7)),
            day: Number(day.slice(8, 10)),
            hour: 12, // Midday — never lands on a DST gap.
            minute: 0,
          },
          timezone,
        ).toISOString(),
        timezone,
      )
    : ''

  // The id is bound at hook level, so the dialog owns the pending slot and the
  // mutation is re-created as the selection changes.
  const deleteSlot = useDeleteSlot(pendingDelete?.id ?? '')

  const confirmDelete = () => {
    deleteSlot.mutate(undefined, {
      onSuccess: () => {
        toast.success('Slot cancelled')
        setPendingDelete(null)
        router.refresh()
      },
      onError: (error) => toast.error(error.message || 'Failed to cancel the slot'),
    })
  }

  // Nothing to hang a slot on yet — point at the service editor rather than
  // opening a dialog whose service picker would be empty.
  if (services.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No services yet</CardTitle>
          <CardDescription>
            Slots belong to a service — create one first, then schedule sessions for it.
          </CardDescription>
        </CardHeader>
        {!isReadOnly && (
          <CardContent>
            <Button asChild>
              <Link href="/cabinet/services/new">
                <PlusIcon data-icon="inline-start" />
                New service
              </Link>
            </Button>
          </CardContent>
        )}
      </Card>
    )
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <ToggleGroup
            type="single"
            value={showPast ? 'past' : 'upcoming'}
            onValueChange={(value) => value && setShowPast(value === 'past')}
            variant="outline"
          >
            <ToggleGroupItem value="upcoming">Upcoming ({upcoming.length})</ToggleGroupItem>
            <ToggleGroupItem value="past">Past ({past.length})</ToggleGroupItem>
          </ToggleGroup>

          {/*
            The filter is in the URL, so clearing it is a link back to the
            unfiltered page rather than local state — back/forward keep working.
          */}
          {activeService && (
            <Badge variant="secondary" className="gap-1 py-1 pr-1 pl-2.5 h-6 text-sm text-primary">
              {activeService.title}
              <Button variant="ghost" size="icon" className="size-5 hover:bg-transparent" asChild>
                <Link href="/cabinet/slots" aria-label="Show every service">
                  <XIcon className="size-3.5" />
                </Link>
              </Button>
            </Badge>
          )}

          {day && (
            <Badge variant="secondary" className="gap-1 py-1 pr-1 pl-2.5 h-6 text-sm text-primary">
              {dayLabel}
              <Button
                variant="ghost"
                size="icon"
                className="size-5 hover:bg-transparent"
                onClick={() => selectDay('')}
                aria-label="Show every day"
              >
                <XIcon className="size-3.5" />
              </Button>
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/*
            Replaces the native `<input type="date">`: the browser's own picker
            cannot mark which days have sessions, and that is the question an
            organizer is actually asking when they open a calendar here.
          */}
          <Popover open={isDayPickerOpen} onOpenChange={setDayPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={day ? `Filtering by ${dayLabel}. Change day` : 'Filter slots by day'}
              >
                <CalendarIcon data-icon="inline-start" />
                {day ? dayLabel : 'Any day'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                defaultMonth={defaultMonth}
                selected={selectedDate}
                onSelect={(picked) => {
                  selectDay(picked ? toDayKey(picked) : '')
                  setDayPickerOpen(false)
                }}
                // The whole point: days that have sessions are marked, and the
                // marking distinguishes "still to come" from "already ran".
                modifiers={{ hasUpcoming: upcomingDates, hasPast: pastDates }}
                /*
                 * These class names land on the day's `<td>`, but the visible
                 * day is the `<button>` inside it — styling the cell alone
                 * leaves the number untouched and nothing appears. Hence the
                 * child selector.
                 */
                modifiersClassNames={{
                  hasUpcoming:
                    '[&_button]:font-bold [&_button]:underline [&_button]:decoration-primary [&_button]:decoration-2 [&_button]:underline-offset-4',
                  hasPast:
                    '[&_button]:underline [&_button]:decoration-dotted [&_button]:underline-offset-4 [&_button]:opacity-60',
                }}
              />
              <div className="flex flex-col gap-2 border-t p-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {/* Swatches mirror the day styling above, so the key is self-evident. */}
                  <span className="font-bold text-foreground underline decoration-primary decoration-2 underline-offset-4">
                    Upcoming
                  </span>
                  <span className="underline decoration-dotted underline-offset-4 opacity-60">
                    Past
                  </span>
                  <span>No sessions — unmarked</span>
                </div>
                {day && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      selectDay('')
                      setDayPickerOpen(false)
                    }}
                  >
                    Show every day
                  </Button>
                )}
              </div>
            </PopoverContent>
          </Popover>

          <Button size="sm" disabled={isReadOnly} onClick={() => setDialog({ mode: 'create' })}>
            <PlusIcon data-icon="inline-start" />
            Add slot
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{showPast ? 'Past sessions' : 'Upcoming schedule'}</CardTitle>
          <CardDescription>
            {visible.length === 0
              ? showPast
                ? 'Nothing has run yet.'
                : 'No upcoming sessions.'
              : `${visible.length} ${showPast ? 'past' : 'upcoming'} ${
                  visible.length === 1 ? 'slot' : 'slots'
                }${activeService ? ` for ${activeService.title}` : ''}${
                  day ? ` on ${dayLabel}` : ''
                }.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {visible.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CalendarPlusIcon />
                </EmptyMedia>
                <EmptyTitle>
                  {day
                    ? 'Nothing on this day'
                    : showPast
                      ? 'No past sessions'
                      : 'Nothing scheduled'}
                </EmptyTitle>
                <EmptyDescription>
                  {day
                    ? `No ${showPast ? 'past' : 'upcoming'} sessions on ${dayLabel}${
                        activeService ? ` for ${activeService.title}` : ''
                      }.`
                    : showPast
                      ? 'Sessions move here once their start time passes.'
                      : activeService
                        ? `${activeService.title} has no upcoming sessions yet.`
                        : 'Add a time slot and guests will be able to book it.'}
                </EmptyDescription>
                {day && (
                  <Button variant="outline" size="sm" onClick={() => selectDay('')}>
                    Show every day
                  </Button>
                )}
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead>Date &amp; time</TableHead>
                  <TableHead>Capacity</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((slot) => {
                  const service = servicesById.get(slot.serviceId)
                  const left = seatsLeft(slot)
                  const pct = Math.round((slot.bookedCount / slot.capacity) * 100)
                  const fill = FILL_BADGE[fillLabel(slot)]

                  return (
                    <TableRow key={slot.id}>
                      <TableCell className="font-medium">{service?.title}</TableCell>
                      <TableCell className="text-muted-foreground">
                        <div className="flex flex-col">
                          <span>{formatDate(slot.startsAt, timezone)}</span>
                          <span className="text-xs">
                            {formatTime(slot.startsAt, timezone)} · {slot.durationMinutes} min
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex w-32 flex-col gap-1">
                          <span className="text-xs text-muted-foreground">
                            {slot.bookedCount}/{slot.capacity} · {left} left
                          </span>
                          <Progress value={pct} />
                        </div>
                      </TableCell>
                      <TableCell>{slotPrice(slot, service)}</TableCell>
                      <TableCell>
                        <Badge variant={fill.variant}>{fill.label}</Badge>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-8">
                              <MoreHorizontalIcon />
                              <span className="sr-only">Slot actions</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuGroup>
                              <DropdownMenuItem
                                disabled={isReadOnly}
                                onSelect={() => setDialog({ mode: 'edit', slot })}
                              >
                                Edit slot
                              </DropdownMenuItem>
                              <DropdownMenuItem asChild>
                                <Link href="/cabinet/bookings">View bookings</Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={isReadOnly}
                                onSelect={() => setDialog({ mode: 'duplicate', slot })}
                              >
                                Duplicate
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                disabled={isReadOnly}
                                onSelect={() => setPendingDelete(slot)}
                              >
                                Cancel slot
                              </DropdownMenuItem>
                            </DropdownMenuGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/*
        Keyed by mode + slot id so each opening mounts a fresh form:
        `defaultValues` are read once per mount, so a reused instance would show
        the previously edited slot's values.
      */}
      {dialog && (
        <SlotDialog
          key={`${dialog.mode}-${dialog.slot?.id ?? 'new'}`}
          open
          onOpenChange={(open) => !open && setDialog(null)}
          services={services}
          defaultServiceId={activeServiceId}
          timezone={timezone}
          mode={dialog.mode}
          slot={dialog.slot}
        />
      )}

      <AlertDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this slot?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.bookedCount
                ? `This session has ${pendingDelete.bookedCount} booked ${
                    pendingDelete.bookedCount === 1 ? 'seat' : 'seats'
                  }. Cancelling removes the slot and every booking on it. This cannot be undone.`
                : 'The slot will be removed and guests will no longer see it. This cannot be undone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteSlot.isPending}>Keep slot</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                // Keep the dialog up while the request is in flight; it closes
                // in `onSuccess`, so a failure leaves the confirm recoverable.
                event.preventDefault()
                confirmDelete()
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleteSlot.isPending ? 'Cancelling...' : 'Cancel slot'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
