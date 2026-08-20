'use client'

import type { ServiceRecord, SlotFill, TimeSlotRecord } from '@repo/contracts'
import { fillLabel, seatsLeft, slotPrice } from '@repo/contracts'
import { CalendarPlusIcon, MoreHorizontalIcon, PlusIcon } from 'lucide-react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'

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
  const state = useSlotsTable({ slots, services, timezone, nowIso, activeServiceId })
  const t = useTranslations('Cabinet.slots')
  const td = useTranslations('Cabinet.dayFilter')
  const tc = useTranslations('Cabinet.common')
  const tsv = useTranslations('Cabinet.services')
  const locale = useLocale()

  // Nothing to hang a slot on yet — point at the service editor rather than
  // opening a dialog whose service picker would be empty.
  if (services.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('noServicesYet')}</CardTitle>
          <CardDescription>{t('noServicesDescription')}</CardDescription>
        </CardHeader>
        {!isReadOnly && (
          <CardContent>
            <Button asChild>
              <Link href="/cabinet/services/new">
                <PlusIcon data-icon="inline-start" />
                {tsv('newService')}
              </Link>
            </Button>
          </CardContent>
        )}
      </Card>
    )
  }

  const FILL_BADGE: Record<
    SlotFill,
    { label: string; variant: 'secondary' | 'outline' | 'default' }
  > = {
    open: { label: t('open'), variant: 'outline' },
    filling: { label: t('fillingUp'), variant: 'default' },
    full: { label: t('full'), variant: 'secondary' },
  }

  const visibleCountLabel = state.showPast
    ? t('pastCount', { count: state.visible.length })
    : t('upcomingCount', { count: state.visible.length })

  const suffix =
    (state.activeService ? t('forServiceSuffix', { service: state.activeService.title }) : '') +
    (state.day ? ` · ${state.dayLabel}` : '')

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <ToggleGroup
            type="single"
            value={state.showPast ? 'past' : 'upcoming'}
            onValueChange={(value) => value && state.setShowPast(value === 'past')}
            variant="outline"
          >
            <ToggleGroupItem value="upcoming">
              {t('upcoming', { count: state.upcoming.length })}
            </ToggleGroupItem>
            <ToggleGroupItem value="past">
              {t('past', { count: state.past.length })}
            </ToggleGroupItem>
          </ToggleGroup>

          {/*
            The filter is in the URL, so clearing it is a link back to the
            unfiltered page rather than local state — back/forward keep working.
          */}
          {state.activeService && (
            <FilterChip
              label={state.activeService.title}
              clearHref="/cabinet/slots"
              ariaLabel={td('showEveryService')}
            />
          )}

          {state.day && (
            <DayFilterChip dayLabel={state.dayLabel} onClear={() => state.selectDay('')} />
          )}
        </div>

        <div className="flex items-center gap-2">
          <DayFilterPicker
            day={state.day}
            dayLabel={state.dayLabel}
            onSelect={state.selectDay}
            defaultMonth={state.defaultMonth}
            entityLabel="slots"
            // The whole point: days that have sessions are marked, and the
            // marking distinguishes "still to come" from "already ran".
            modifiers={{ hasUpcoming: state.upcomingDates, hasPast: state.pastDates }}
            modifiersClassNames={{
              hasUpcoming: DAY_MARK.strong.calendarCell,
              hasPast: DAY_MARK.muted.calendarCell,
            }}
          />

          <Button
            size="sm"
            disabled={isReadOnly}
            onClick={() => state.setDialog({ mode: 'create' })}
          >
            <PlusIcon data-icon="inline-start" />
            {t('addSlot')}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{state.showPast ? t('pastSessions') : t('upcomingSchedule')}</CardTitle>
          <CardDescription>
            {state.visible.length === 0
              ? state.showPast
                ? t('nothingRun')
                : t('noUpcomingSessions')
              : `${visibleCountLabel}${suffix}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {state.visible.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CalendarPlusIcon />
                </EmptyMedia>
                <EmptyTitle>
                  {state.day
                    ? t('nothingOnDay')
                    : state.showPast
                      ? t('noPastSessions')
                      : t('nothingScheduled')}
                </EmptyTitle>
                <EmptyDescription>
                  {state.day
                    ? `${state.showPast ? t('noPastOnDay', { day: state.dayLabel }) : t('noUpcomingOnDay', { day: state.dayLabel })}${
                        state.activeService
                          ? t('forServiceSuffix', { service: state.activeService.title })
                          : ''
                      }.`
                    : state.showPast
                      ? t('sessionsMove')
                      : state.activeService
                        ? t('noUpcomingFor', { service: state.activeService.title })
                        : t('addHint')}
                </EmptyDescription>
                {state.day && (
                  <Button variant="outline" size="sm" onClick={() => state.selectDay('')}>
                    {td('showEveryDay')}
                  </Button>
                )}
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colService')}</TableHead>
                  <TableHead>{t('colDateTime')}</TableHead>
                  <TableHead>{t('colCapacity')}</TableHead>
                  <TableHead>{t('colPrice')}</TableHead>
                  <TableHead>{t('colStatus')}</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.visible.map((slot) => {
                  const service = state.servicesById.get(slot.serviceId)
                  const left = seatsLeft(slot)
                  const pct = Math.round((slot.bookedCount / slot.capacity) * 100)
                  const fill = FILL_BADGE[fillLabel(slot)]

                  return (
                    <TableRow key={slot.id}>
                      <TableCell className="font-medium">{service?.title}</TableCell>
                      <TableCell className="text-muted-foreground">
                        <div className="flex flex-col">
                          <span>{formatDate(slot.startsAt, timezone, locale)}</span>
                          <span className="text-xs">
                            {formatTime(slot.startsAt, timezone, locale)} ·{' '}
                            {tc('min', { minutes: slot.durationMinutes })}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex w-32 flex-col gap-1">
                          <span className="text-xs text-muted-foreground">
                            {slot.bookedCount}/{slot.capacity} · {t('left', { count: left })}
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
                              <span className="sr-only">{t('slotActions')}</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuGroup>
                              <DropdownMenuItem
                                disabled={isReadOnly}
                                onSelect={() => state.setDialog({ mode: 'edit', slot })}
                              >
                                {t('editSlot')}
                              </DropdownMenuItem>
                              <DropdownMenuItem asChild>
                                {/* Deep link into the bookings page filtered to this session. */}
                                <Link href={`/cabinet/bookings?slot=${slot.id}`}>
                                  {t('viewBookings')}
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={isReadOnly}
                                onSelect={() => state.setDialog({ mode: 'duplicate', slot })}
                              >
                                {t('duplicate')}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                disabled={isReadOnly}
                                onSelect={() => state.setPendingDelete(slot)}
                              >
                                {t('cancelSlot')}
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
      {state.dialog && (
        <SlotDialog
          key={`${state.dialog.mode}-${state.dialog.slot?.id ?? 'new'}`}
          open
          onOpenChange={(open) => !open && state.setDialog(null)}
          services={services}
          defaultServiceId={activeServiceId}
          timezone={timezone}
          mode={state.dialog.mode}
          slot={state.dialog.slot}
        />
      )}

      <AlertDialog
        open={Boolean(state.pendingDelete)}
        onOpenChange={(open) => !open && state.setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('cancelTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {state.pendingDelete?.bookedCount
                ? t('cancelDescriptionWithBookings', {
                    count: state.pendingDelete.bookedCount,
                  })
                : t('cancelDescriptionPlain')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={state.deleteSlot.isPending}>
              {t('keepSlot')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                // Keep the dialog up while the request is in flight; it closes
                // in `onSuccess`, so a failure leaves the confirm recoverable.
                event.preventDefault()
                state.confirmDelete()
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {state.deleteSlot.isPending ? t('cancellingDialog') : t('cancelSlot')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
