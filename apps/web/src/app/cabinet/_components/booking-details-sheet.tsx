'use client'

import type { BookingRecord, ServiceRecord, TimeSlotRecord } from '@repo/contracts'
import { XIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { useCancelBookingByOrganizer } from '@/api-client'
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
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { formatDateTime } from '@/helpers/date'
import { initials } from '@/helpers/name'

type BookingDetailsSheetProps = {
  /**
   * The booking to show, or `null` when nothing is selected — which is also
   * what closes the sheet. Kept as the booking rather than a boolean `open` so
   * the header can name it while the closing animation plays out.
   */
  booking: BookingRecord | null
  /**
   * The booking's service and slot, resolved by the caller: a booking reaches
   * its service transitively (Booking → TimeSlot → Service, docs/domain.md),
   * and each surface already holds the lists needed to walk that chain.
   */
  service?: ServiceRecord
  slot?: TimeSlotRecord
  /** Organizer timezone — the slot instant is shown as their local time. */
  timezone: string
  /** Read-only demo account (ADR-010): the footer actions are disabled. */
  isReadOnly: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * The booking details panel, shared by the bookings table and the cabinet
 * overview.
 *
 * Fully controlled — the selection lives in whichever list opened it. That is
 * what lets two very different rows (a table row, an avatar line in a summary
 * card) share one panel without sharing their markup.
 *
 * Cancellation lives **here** rather than in each caller: it is an action on the
 * booking this panel already describes, and both surfaces would otherwise
 * duplicate the mutation, the confirm dialog and the refresh — three chances to
 * drift apart.
 */
export function BookingDetailsSheet({
  booking,
  service,
  slot,
  timezone,
  isReadOnly,
  onOpenChange,
}: BookingDetailsSheetProps) {
  const router = useRouter()
  const cancelBooking = useCancelBookingByOrganizer()
  const t = useTranslations('Cabinet.booking')
  const tc = useTranslations('Cabinet.common')
  const locale = useLocale()

  async function handleCancel(target: BookingRecord) {
    try {
      await cancelBooking.mutateAsync(target.id)
      toast.success(t('cancelledToast'), {
        description: t('releasedToast', { name: target.guestName }),
      })
      // The panel closes before the refresh lands: the callers hold the selected
      // booking in state, so the copy behind this sheet still says `confirmed`
      // until their server data arrives. Closing avoids showing that stale row.
      onOpenChange(false)
      // Cabinet pages are server components — this is what re-reads Postgres and
      // repaints the released seat in the lists and slot counts.
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('cancelFailed'))
    }
  }

  const when = slot ? formatDateTime(slot.startsAt, timezone, locale) : undefined

  const cancelDescription = booking
    ? service && when
      ? t('cancelDescriptionBoth', { name: booking.guestName, seats: booking.seats, service: service.title, when })
      : service
        ? t('cancelDescriptionService', { name: booking.guestName, seats: booking.seats, service: service.title })
        : when
          ? t('cancelDescriptionWhen', { name: booking.guestName, seats: booking.seats, when })
          : t('cancelDescriptionPlain', { name: booking.guestName, seats: booking.seats })
    : undefined

  return (
    <Sheet open={Boolean(booking)} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col">
        <SheetHeader>
          <SheetTitle>{t('details')}</SheetTitle>
        </SheetHeader>
        {booking && (
          <div className="flex flex-1 flex-col gap-5 overflow-auto px-4">
            <div className="flex items-center gap-3">
              <Avatar className="size-11">
                <AvatarFallback>{initials(booking.guestName)}</AvatarFallback>
              </Avatar>
              <div className="flex flex-col">
                <span className="font-medium">{booking.guestName}</span>
              </div>
              <Badge
                className="ms-auto"
                variant={booking.status === 'confirmed' ? 'default' : 'secondary'}
              >
                {booking.status === 'confirmed' ? tc('confirmed') : tc('cancelled')}
              </Badge>
            </div>

            <Separator />

            <dl className="grid grid-cols-1 gap-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{t('service')}</dt>
                <dd className="text-right font-medium">{service?.title}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{t('when')}</dt>
                <dd className="text-right font-medium">{when ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{t('seats')}</dt>
                <dd className="text-right font-medium">{booking.seats}</dd>
              </div>
              {booking.guestMessengerLogin && (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground capitalize">{booking.guestMessenger}</dt>
                  <dd className="text-right font-medium capitalize">
                    {
                      booking.guestMessenger === 'telegram' ? (
                        <a
                          href={`https://t.me/${booking.guestMessengerLogin.replace(/^@/, '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {booking.guestMessengerLogin}
                        </a>
                      ) : null /* TODO: add other messengers */
                    }
                  </dd>
                </div>
              )}
              {booking.selectedOptions && booking.selectedOptions.length > 0 && (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{t('options')}</dt>
                  <dd className="flex flex-wrap justify-end gap-1">
                    {booking.selectedOptions.map((o) => (
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
          {booking?.status === 'confirmed' && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  // The demo organizer is read-only (ADR-010). The server
                  // refuses it too — this only spares the pointless round trip.
                  disabled={isReadOnly || cancelBooking.isPending}
                >
                  <XIcon data-icon="inline-start" />
                  {cancelBooking.isPending ? t('cancelling') : t('cancelBooking')}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('cancelTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>{cancelDescription}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('keepBooking')}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => handleCancel(booking)}>
                    {t('yesCancel')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <SheetClose asChild>
            <Button variant="ghost">{tc('close')}</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
