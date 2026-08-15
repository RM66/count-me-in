'use client'

import type { ServiceRecord, SlotFill, TimeSlotRecord } from '@repo/contracts'
import { fillLabel, seatsLeft, slotPrice } from '@repo/contracts'
import { CalendarPlusIcon, MoreHorizontalIcon, PlusIcon } from 'lucide-react'
import Link from 'next/link'

import { DayFilterChip, DayFilterPicker } from '@/app/cabinet/_components/day-filter'
import { FilterChip } from '@/app/cabinet/_components/filter-chip'
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
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
import { formatDate, formatTime } from '@/helpers/date'
import { SlotDialog } from './slot-dialog'
import { DAY_MARK, useSlotsTable } from './use-slots-table'

const FILL_BADGE: Record<
  SlotFill,
  { label: string; variant: 'secondary' | 'outline' | 'default' }
> = {
  open: { label: 'Open', variant: 'outline' },
  filling: { label: 'Filling up', variant: 'default' },
  full: { label: 'Full', variant: 'secondary' },
}

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
 * of truth for what the table shows. The filtering, day-selection and delete
 * logic lives in [`useSlotsTable`](use-slots-table.ts).
 */
export function SlotsTable({
  slots,
  services,
  timezone,
  nowIso,
  activeServiceId,
  isReadOnly,
}: SlotsTableProps) {
  const t = useSlotsTable({ slots, services, timezone, nowIso, activeServiceId })

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
            value={t.showPast ? 'past' : 'upcoming'}
            onValueChange={(value) => value && t.setShowPast(value === 'past')}
            variant="outline"
          >
            <ToggleGroupItem value="upcoming">Upcoming ({t.upcoming.length})</ToggleGroupItem>
            <ToggleGroupItem value="past">Past ({t.past.length})</ToggleGroupItem>
          </ToggleGroup>

          {/*
            The filter is in the URL, so clearing it is a link back to the
            unfiltered page rather than local state — back/forward keep working.
          */}
          {t.activeService && (
            <FilterChip
              label={t.activeService.title}
              clearHref="/cabinet/slots"
              ariaLabel="Show every service"
            />
          )}

          {t.day && <DayFilterChip dayLabel={t.dayLabel} onClear={() => t.selectDay('')} />}
        </div>

        <div className="flex items-center gap-2">
          <DayFilterPicker
            day={t.day}
            dayLabel={t.dayLabel}
            onSelect={t.selectDay}
            defaultMonth={t.defaultMonth}
            entityLabel="slots"
            // The whole point: days that have sessions are marked, and the
            // marking distinguishes "still to come" from "already ran".
            modifiers={{ hasUpcoming: t.upcomingDates, hasPast: t.pastDates }}
            modifiersClassNames={{
              hasUpcoming: DAY_MARK.strong.calendarCell,
              hasPast: DAY_MARK.muted.calendarCell,
            }}
          />

          <Button size="sm" disabled={isReadOnly} onClick={() => t.setDialog({ mode: 'create' })}>
            <PlusIcon data-icon="inline-start" />
            Add slot
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t.showPast ? 'Past sessions' : 'Upcoming schedule'}</CardTitle>
          <CardDescription>
            {t.visible.length === 0
              ? t.showPast
                ? 'Nothing has run yet.'
                : 'No upcoming sessions.'
              : `${t.visible.length} ${t.showPast ? 'past' : 'upcoming'} ${
                  t.visible.length === 1 ? 'slot' : 'slots'
                }${t.activeService ? ` for ${t.activeService.title}` : ''}${
                  t.day ? ` on ${t.dayLabel}` : ''
                }.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {t.visible.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CalendarPlusIcon />
                </EmptyMedia>
                <EmptyTitle>
                  {t.day
                    ? 'Nothing on this day'
                    : t.showPast
                      ? 'No past sessions'
                      : 'Nothing scheduled'}
                </EmptyTitle>
                <EmptyDescription>
                  {t.day
                    ? `No ${t.showPast ? 'past' : 'upcoming'} sessions on ${t.dayLabel}${
                        t.activeService ? ` for ${t.activeService.title}` : ''
                      }.`
                    : t.showPast
                      ? 'Sessions move here once their start time passes.'
                      : t.activeService
                        ? `${t.activeService.title} has no upcoming sessions yet.`
                        : 'Add a time slot and guests will be able to book it.'}
                </EmptyDescription>
                {t.day && (
                  <Button variant="outline" size="sm" onClick={() => t.selectDay('')}>
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
                  <TableHead>Date & time</TableHead>
                  <TableHead>Capacity</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {t.visible.map((slot) => {
                  const service = t.servicesById.get(slot.serviceId)
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
                                onSelect={() => t.setDialog({ mode: 'edit', slot })}
                              >
                                Edit slot
                              </DropdownMenuItem>
                              <DropdownMenuItem asChild>
                                {/* Deep link into the bookings page filtered to this session. */}
                                <Link href={`/cabinet/bookings?slot=${slot.id}`}>
                                  View bookings
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={isReadOnly}
                                onSelect={() => t.setDialog({ mode: 'duplicate', slot })}
                              >
                                Duplicate
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                disabled={isReadOnly}
                                onSelect={() => t.setPendingDelete(slot)}
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
      {t.dialog && (
        <SlotDialog
          key={`${t.dialog.mode}-${t.dialog.slot?.id ?? 'new'}`}
          open
          onOpenChange={(open) => !open && t.setDialog(null)}
          services={services}
          defaultServiceId={activeServiceId}
          timezone={timezone}
          mode={t.dialog.mode}
          slot={t.dialog.slot}
        />
      )}

      <AlertDialog
        open={Boolean(t.pendingDelete)}
        onOpenChange={(open) => !open && t.setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this slot?</AlertDialogTitle>
            <AlertDialogDescription>
              {t.pendingDelete?.bookedCount
                ? `This session has ${t.pendingDelete.bookedCount} booked ${
                    t.pendingDelete.bookedCount === 1 ? 'seat' : 'seats'
                  }. Cancelling removes the slot and every booking on it. This cannot be undone.`
                : 'The slot will be removed and guests will no longer see it. This cannot be undone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={t.deleteSlot.isPending}>Keep slot</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                // Keep the dialog up while the request is in flight; it closes
                // in `onSuccess`, so a failure leaves the confirm recoverable.
                event.preventDefault()
                t.confirmDelete()
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {t.deleteSlot.isPending ? 'Cancelling...' : 'Cancel slot'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
