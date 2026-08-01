'use client'

import type { ServiceRecord, SlotFill, TimeSlotRecord } from '@repo/api-contracts'
import { fillLabel, seatsLeft, slotPrice } from '@repo/api-contracts'
import { CalendarPlusIcon, MoreHorizontalIcon, PlusIcon, XIcon } from 'lucide-react'
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

  const servicesById = new Map(services.map((service) => [service.id, service]))
  const activeService = activeServiceId ? servicesById.get(activeServiceId) : undefined

  // Service filter first, so the Upcoming/Past counts describe what the
  // organizer is actually looking at rather than the whole schedule.
  const scoped = activeServiceId
    ? slots.filter((slot) => slot.serviceId === activeServiceId)
    : slots

  // Past sessions stay reachable behind a toggle rather than being dropped: a
  // slot saved with a stale date would otherwise just never appear, which
  // reads as "the save failed".
  const upcoming = scoped.filter((slot) => slot.startsAt >= nowIso)
  const past = scoped.filter((slot) => slot.startsAt < nowIso)
  const visible = showPast ? past : upcoming

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
        </div>

        <Button size="sm" disabled={isReadOnly} onClick={() => setDialog({ mode: 'create' })}>
          <PlusIcon data-icon="inline-start" />
          Add slot
        </Button>
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
                }${activeService ? ` for ${activeService.title}` : ''}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {visible.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CalendarPlusIcon />
                </EmptyMedia>
                <EmptyTitle>{showPast ? 'No past sessions' : 'Nothing scheduled'}</EmptyTitle>
                <EmptyDescription>
                  {showPast
                    ? 'Sessions move here once their start time passes.'
                    : activeService
                      ? `${activeService.title} has no upcoming sessions yet.`
                      : 'Add a time slot and guests will be able to book it.'}
                </EmptyDescription>
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
