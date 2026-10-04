'use client'

import type { ServiceRecord, TimeSlotRecord } from '@repo/contracts'
import { CalendarPlusIcon, PlusIcon } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DeleteSlotDialog } from './delete-slot-dialog'
import { SlotDialog } from './slot-dialog'
import { SlotRow } from './slot-row'
import { SlotsToolbar } from './slots-toolbar'
import { useSlotsTable } from './use-slots-table'

type SlotsTableProps = {
  slots: TimeSlotRecord[]
  services: ServiceRecord[]
  /** Organizer timezone — slots are stored as instants, shown as local time. */
  timezone: string
  /** "Now" as the server saw it, so the upcoming/past split cannot mismatch on hydration. */
  nowIso: string
  /** Show only this service's slots. Comes from `?service=` — already validated by the page. */
  activeServiceId?: string
  /** URL-derived filter state — the page parsed and validated each value. */
  day?: string
  showPast?: boolean
  /** Read-only demo account (ADR-010). */
  isReadOnly: boolean
}

/**
 * The cabinet slot schedule: a live table plus its create / edit / duplicate /
 * delete affordances.
 *
 * A client component because every action here is interactive, but the **data
 * is passed in** — the page is a server component that reads through the API,
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
  day,
  showPast,
  isReadOnly,
}: SlotsTableProps) {
  const state = useSlotsTable({
    slots,
    services,
    timezone,
    nowIso,
    activeServiceId,
    day,
    showPast,
  })
  const t = useTranslations('Cabinet.slots')
  const td = useTranslations('Cabinet.dayFilter')
  const tsv = useTranslations('Cabinet.services')

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

  const visibleCountLabel = state.showPast
    ? t('pastCount', { count: state.visible.length })
    : t('upcomingCount', { count: state.visible.length })

  const suffix =
    (state.activeService ? t('forServiceSuffix', { service: state.activeService.title }) : '') +
    (state.day ? ` · ${state.dayLabel}` : '')

  return (
    <>
      <SlotsToolbar state={state} isReadOnly={isReadOnly} />

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
                {state.visible.map((slot) => (
                  <SlotRow
                    key={slot.id}
                    slot={slot}
                    service={state.servicesById.get(slot.serviceId)}
                    timezone={timezone}
                    isReadOnly={isReadOnly}
                    onEdit={(s) => state.setDialog({ mode: 'edit', slot: s })}
                    onDuplicate={(s) => state.setDialog({ mode: 'duplicate', slot: s })}
                    onDelete={state.setPendingDelete}
                  />
                ))}
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

      <DeleteSlotDialog
        slot={state.pendingDelete}
        isPending={state.deleteSlot.isPending}
        onConfirm={state.confirmDelete}
        onClose={() => state.setPendingDelete(null)}
      />
    </>
  )
}
