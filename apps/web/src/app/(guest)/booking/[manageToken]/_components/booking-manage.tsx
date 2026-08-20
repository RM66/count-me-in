'use client'

import type { GuestBooking } from '@repo/contracts'
import { effectiveContact, effectiveLocation, slotEnd, slotPrice } from '@repo/contracts'
import { Calendar, CheckCircle2, Clock, Tag, User, XCircle } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import { toast } from 'sonner'

import { useCancelBooking } from '@/api-client'
import { AddToCalendar } from '@/app/(guest)/_components/add-to-calendar'
import { ContactLink } from '@/components/contact-link'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { formatDate, formatTime } from '@/helpers/date'

/**
 * The guest's view of one of their bookings, reached by `manageToken`.
 *
 * A client component because cancelling is interactive, but the booking itself
 * is **passed in** from the server page — the same split every cabinet table
 * uses. The whole parent chain travels inside `booking`, so this renders without
 * a single fetch of its own.
 */
export function BookingManage({ booking }: { booking: GuestBooking }) {
  const router = useRouter()
  const cancelBooking = useCancelBooking()
  const t = useTranslations('ManageBooking')
  const locale = useLocale()

  /**
   * The booking as currently known: the server's copy until a cancellation
   * replaces it with the response. Cancelling returns the updated booking, so
   * the card re-renders from real data rather than from a local `cancelled`
   * boolean that only *claims* the write succeeded.
   */
  const [current, setCurrent] = useState(booking)

  const { slot, service, organizer } = current
  const cancelled = current.status === 'cancelled'

  const location = effectiveLocation(service, organizer)
  const contact = effectiveContact(service, organizer)

  async function handleCancel() {
    try {
      const result = await cancelBooking.mutateAsync(current.manageToken)
      setCurrent(result.booking)
      toast.success(t('bookingCancelled'))
      // The seat is back in the pool, so the organizer's page and this route's
      // server render both have stale counts until a refresh.
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message || t('cancelFailed') : t('cancelFailed'))
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{service.title}</CardTitle>
          {cancelled ? (
            <Badge variant="secondary" className="gap-1">
              <XCircle className="size-3.5" />
              {t('cancelled')}
            </Badge>
          ) : (
            <Badge className="gap-1">
              <CheckCircle2 className="size-3.5" />
              {t('confirmed')}
            </Badge>
          )}
        </div>
        <CardDescription>
          {t('bookingWith', {
            name: organizer.name,
            date: formatDate(slot.startsAt, organizer.timezone, locale),
          })}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        <dl className="flex flex-col gap-3 text-sm">
          <Row icon={Calendar} label={t('date')}>
            {formatDate(slot.startsAt, organizer.timezone, locale)}
          </Row>
          <Row icon={Clock} label={t('time')}>
            {formatTime(slot.startsAt, organizer.timezone, locale)} ·{' '}
            {t('minutes', { minutes: slot.durationMinutes })}
          </Row>
          <Row icon={User} label={t('name')}>
            {current.guestName}
          </Row>
          <Row icon={Tag} label={t('price')}>
            {slotPrice(slot, service)}
          </Row>
        </dl>

        {/*
          Location and contact follow the service-overrides-organizer rule from
          docs/domain.md; the guest sees whichever value actually applies.
        */}
        {location || contact ? (
          <>
            <Separator />
            <dl className="flex flex-col gap-3 text-sm">
              {location ? (
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">{t('where')}</dt>
                  <dd className="text-right font-medium">{location}</dd>
                </div>
              ) : null}
              {contact ? (
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">{t('contact')}</dt>
                  <dd className="text-right font-medium">
                    <ContactLink contact={contact} />
                  </dd>
                </div>
              ) : null}
            </dl>
          </>
        ) : null}

        {current.selectedOptions?.length ? (
          <>
            <Separator />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">{t('options')}</span>
              {current.selectedOptions.map((opt) => (
                <Badge key={opt} variant="outline" className="font-normal">
                  {opt}
                </Badge>
              ))}
            </div>
          </>
        ) : null}
      </CardContent>

      <CardFooter className="flex-col gap-2">
        {cancelled ? (
          <div className="flex w-full flex-col gap-2">
            <p className="text-center text-sm text-muted-foreground">{t('cancelledNote')}</p>
            <Button variant="outline" className="w-full" asChild>
              <Link href={`/${organizer.slug}`}>{t('bookAnotherTime')}</Link>
            </Button>
          </div>
        ) : (
          <div className="flex w-full flex-col gap-2 sm:flex-row-reverse sm:justify-between">
            <AddToCalendar
              title={service.title}
              startsAt={slot.startsAt}
              endsAt={slotEnd(slot)}
              location={location}
              variant="default"
              className="w-full sm:w-auto"
            />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full text-destructive hover:text-destructive sm:w-auto"
                  disabled={cancelBooking.isPending}
                >
                  {cancelBooking.isPending ? t('cancelling') : t('cancelBooking')}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('cancelConfirmTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t('cancelConfirmDescription', {
                      title: service.title,
                      date: formatDate(slot.startsAt, organizer.timezone, locale),
                      time: formatTime(slot.startsAt, organizer.timezone, locale),
                    })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('keepBooking')}</AlertDialogCancel>
                  <AlertDialogAction onClick={handleCancel}>{t('yesCancel')}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </CardFooter>
    </Card>
  )
}

function Row({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" />
        {label}
      </dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  )
}
