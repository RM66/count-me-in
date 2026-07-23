'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
import { AddToCalendar } from '@/components/guest/add-to-calendar'
import { CheckCircle2, XCircle, Calendar, Clock, User, Phone, Tag } from 'lucide-react'
import { toast } from 'sonner'
import {
  type Booking,
  type Organizer,
  type Service,
  type TimeSlot,
  formatDate,
  formatTime,
  slotEnd,
  slotPrice,
} from '@/lib/mock-data'

export function BookingManage({
  booking,
  service,
  slot,
  organizer,
}: {
  booking: Booking
  service: Service
  slot: TimeSlot
  organizer: Organizer
}) {
  const [cancelled, setCancelled] = useState(booking.status === 'cancelled')

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{service.title}</CardTitle>
          {cancelled ? (
            <Badge variant="secondary" className="gap-1">
              <XCircle className="size-3.5" />
              Cancelled
            </Badge>
          ) : (
            <Badge className="gap-1">
              <CheckCircle2 className="size-3.5" />
              Confirmed
            </Badge>
          )}
        </div>
        <CardDescription>
          Booking with {organizer.name} · {formatDate(slot.startsAt)}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        <dl className="flex flex-col gap-3 text-sm">
          <Row icon={Calendar} label="Date">
            {formatDate(slot.startsAt)}
          </Row>
          <Row icon={Clock} label="Time">
            {formatTime(slot.startsAt)} · {slot.durationMinutes} min
          </Row>
          <Row icon={User} label="Name">
            {booking.guestName}
          </Row>
          <Row icon={Phone} label="Phone">
            {booking.guestPhone}
          </Row>
          <Row icon={Tag} label="Price">
            {slotPrice(slot)}
          </Row>
        </dl>

        {booking.selectedOptions?.length ? (
          <>
            <Separator />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Options:</span>
              {booking.selectedOptions.map((opt) => (
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
            <p className="text-center text-sm text-muted-foreground">
              This booking was cancelled and the seat has been released.
            </p>
            <Button variant="outline" className="w-full" asChild>
              <Link href={`/${organizer.slug}`}>Book another time</Link>
            </Button>
          </div>
        ) : (
          <>
            <AddToCalendar
              title={service.title}
              startsAt={slot.startsAt}
              endsAt={slotEnd(slot)}
              variant="default"
            />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full text-destructive hover:text-destructive"
                >
                  Cancel booking
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel this booking?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Your seat for {service.title} on {formatDate(slot.startsAt)} at{' '}
                    {formatTime(slot.startsAt)} will be released. This can’t be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep booking</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      setCancelled(true)
                      toast.success('Booking cancelled')
                    }}
                  >
                    Yes, cancel
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
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
