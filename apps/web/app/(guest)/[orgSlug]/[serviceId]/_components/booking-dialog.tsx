'use client'

import type {
  GuestBooking,
  GuestTicketResponse,
  PublicOrganizer,
  ServiceRecord,
  TimeSlotRecord,
} from '@repo/api-contracts'
import { effectiveLocation, seatsLeft, slotEnd, slotPrice } from '@repo/api-contracts'
import { AlertCircle, ArrowLeft, CheckCircle2, PartyPopper } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type ComponentProps, useState } from 'react'

import { AddToCalendar } from '@/app/(guest)/_components/add-to-calendar'
import { SeatsBadge } from '@/app/(guest)/[orgSlug]/[serviceId]/_components/seats-badge'
import { TelegramLoginButton } from '@/components/telegram-login-button'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { useCreateBooking } from '@/lib/api'
import { formatDate, formatTime } from '@/lib/helpers/date'
import { cn } from '@/lib/utils'

/**
 * The guest booking flow (docs/pages.md): pick slot → options → name → Telegram
 * → confirmation, as a stepper inside one dialog rather than separate routes.
 *
 * The last two steps are one round trip each and in a fixed order: the widget
 * proves the identity (`verify`), and only then does `POST /api/bookings` claim
 * the seats. Nothing is reserved before that — the ticket holds no seat
 * (docs/domain.md), so the sold-out case surfaces here, at the moment of
 * booking, and is shown in place instead of as a dead end.
 */

type Step = 'slot' | 'options' | 'details' | 'verify' | 'success'

export function BookingDialog({
  organizer,
  service,
  slots,
  preselectedSlotId,
  triggerLabel,
  triggerDisabled = false,
  triggerVariant,
  triggerSize,
  triggerClassName,
}: {
  organizer: PublicOrganizer
  service: ServiceRecord
  slots: TimeSlotRecord[]
  preselectedSlotId?: string
  /**
   * Trigger content/props, not a pre-built element. The `Button` must be
   * rendered here (client side) rather than assembled in the server-rendered
   * page and passed down as a `trigger` prop — `DialogTrigger asChild` +
   * `Slot` fails to merge props onto an element built across the
   * Server → Client Component boundary (radix-ui/primitives#3780).
   */
  triggerLabel: React.ReactNode
  triggerDisabled?: boolean
  triggerVariant?: ComponentProps<typeof Button>['variant']
  triggerSize?: ComponentProps<typeof Button>['size']
  triggerClassName?: string
}) {
  const router = useRouter()
  const createBooking = useCreateBooking()

  const hasOptions = !!service.options?.length
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('slot')
  const [slotId, setSlotId] = useState<string | undefined>(preselectedSlotId)
  const [selectedOptions, setSelectedOptions] = useState<string[]>([])
  const [name, setName] = useState('')
  /** The completed booking — the only source for the success screen. */
  const [booking, setBooking] = useState<GuestBooking | null>(null)
  /**
   * A failed booking attempt, shown on the `verify` step. Kept in state rather
   * than only as a toast because the common cause is "someone took the last
   * seat", and that has to stay on screen while the guest picks another slot.
   */
  const [error, setError] = useState<string | null>(null)

  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME

  function reset() {
    setStep('slot')
    setSlotId(preselectedSlotId)
    setSelectedOptions([])
    setName('')
    setBooking(null)
    setError(null)
  }

  function goFromSlot() {
    setStep(hasOptions ? 'options' : 'details')
  }

  function toggleOption(value: string) {
    if (service.optionsSelectMode === 'single') {
      setSelectedOptions([value])
    } else {
      setSelectedOptions((prev) =>
        prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
      )
    }
  }

  /**
   * Widget auth succeeded — spend the ticket on the booking straight away.
   *
   * Tickets are short-lived and single-use, so there is nothing to gain by
   * holding one: any pause between the tap and the write is just time for it to
   * expire or for the last seat to go.
   */
  async function handleTicket(ticket: GuestTicketResponse) {
    if (!slotId) return
    setError(null)

    try {
      const result = await createBooking.mutateAsync({
        serviceId: service.id,
        timeSlotId: slotId,
        // One booking is one seat in MVP; `seats` exists on the wire for the
        // group bookings the domain already allows.
        seats: 1,
        guestName: name.trim() || ticket.displayName,
        guestTicket: ticket.ticket,
        selectedOptions: selectedOptions.length > 0 ? selectedOptions : undefined,
      })

      setBooking(result.booking)
      setStep('success')
      // The page is server-rendered, so the new `bookedCount` only appears after
      // a refresh — without this the slot list keeps advertising the seat that
      // was just taken.
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete the booking')
    }
  }

  const stepTitles: Record<Step, string> = {
    slot: 'Pick a time',
    options: 'Choose options',
    details: 'Your details',
    verify: 'Confirm with Telegram',
    success: 'You’re booked!',
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setTimeout(reset, 200)
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant={triggerVariant}
          size={triggerSize}
          className={triggerClassName}
          disabled={triggerDisabled}
        >
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{stepTitles[step]}</DialogTitle>
          <DialogDescription>{service.title}</DialogDescription>
        </DialogHeader>

        {step === 'slot' && (
          <div className="flex flex-col gap-4">
            <RadioGroup value={slotId} onValueChange={setSlotId} className="gap-2">
              {slots.map((s) => {
                const full = seatsLeft(s) === 0
                return (
                  <label
                    key={s.id}
                    htmlFor={`slot-${s.id}`}
                    className={cn(
                      'flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3 transition-colors',
                      slotId === s.id && 'border-primary bg-accent',
                      full && 'cursor-not-allowed opacity-60',
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <RadioGroupItem id={`slot-${s.id}`} value={s.id} disabled={full} />
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">
                          {formatDate(s.startsAt, organizer.timezone)} ·{' '}
                          {formatTime(s.startsAt, organizer.timezone)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {slotPrice(s, service)}
                        </span>
                      </div>
                    </div>
                    <SeatsBadge slot={s} />
                  </label>
                )
              })}
            </RadioGroup>
            <Button disabled={!slotId} onClick={goFromSlot}>
              Continue
            </Button>
          </div>
        )}

        {step === 'options' && (
          <div className="flex flex-col gap-4">
            {service.optionsSelectMode === 'single' ? (
              <RadioGroup
                value={selectedOptions[0]}
                onValueChange={(v) => setSelectedOptions([v])}
                className="gap-2"
              >
                {service.options?.map((opt) => (
                  <label
                    key={opt}
                    htmlFor={`opt-${opt}`}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-lg border p-3',
                      selectedOptions[0] === opt && 'border-primary bg-accent',
                    )}
                  >
                    <RadioGroupItem id={`opt-${opt}`} value={opt} />
                    <span className="text-sm font-medium">{opt}</span>
                  </label>
                ))}
              </RadioGroup>
            ) : (
              <FieldSet>
                <FieldLegend className="sr-only">Options</FieldLegend>
                <div className="flex flex-col gap-2">
                  {service.options?.map((opt) => (
                    <label
                      key={opt}
                      htmlFor={`opt-${opt}`}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-lg border p-3',
                        selectedOptions.includes(opt) && 'border-primary bg-accent',
                      )}
                    >
                      <Checkbox
                        id={`opt-${opt}`}
                        checked={selectedOptions.includes(opt)}
                        onCheckedChange={() => toggleOption(opt)}
                      />
                      <span className="text-sm font-medium">{opt}</span>
                    </label>
                  ))}
                </div>
              </FieldSet>
            )}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep('slot')}>
                <ArrowLeft data-icon="inline-start" />
                Back
              </Button>
              <Button
                className="flex-1"
                disabled={service.optionsSelectMode === 'single' && !selectedOptions.length}
                onClick={() => setStep('details')}
              >
                Continue
              </Button>
            </div>
          </div>
        )}

        {step === 'details' && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              setStep('verify')
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="guest-name">Full name</FieldLabel>
                <Input
                  id="guest-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Mila Petrović"
                  required
                />
                <FieldDescription>The name the organizer will see on their list.</FieldDescription>
              </Field>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setStep(hasOptions ? 'options' : 'slot')}
                >
                  <ArrowLeft data-icon="inline-start" />
                  Back
                </Button>
                <Button type="submit" className="flex-1">
                  Continue
                </Button>
              </div>
            </FieldGroup>
          </form>
        )}

        {step === 'verify' && (
          <div className="flex flex-col gap-4">
            {/*
              The demo organizer is read-only (ADR-010). The API refuses the
              write regardless — this only spares the guest a Telegram tap
              before being told so.
            */}
            {organizer.isDemo ? (
              <div className="flex items-start gap-3 rounded-lg border border-dashed bg-muted/50 p-3 text-sm text-muted-foreground">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <p className="text-pretty">
                  This is a read-only demo page, so bookings are not saved.{' '}
                  <Link href="/signup" className="font-medium text-foreground underline">
                    Create your own
                  </Link>{' '}
                  to take real bookings.
                </p>
              </div>
            ) : (
              <>
                {error && (
                  <div
                    role="alert"
                    className="flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive"
                  >
                    <AlertCircle className="mt-0.5 size-4 shrink-0" />
                    <p className="text-pretty">{error}</p>
                  </div>
                )}
                <p className="text-center text-sm text-muted-foreground text-pretty">
                  Confirm with Telegram — no account needed, and it only proves who you are.
                </p>
                {createBooking.isPending ? (
                  <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
                    <Spinner />
                    Reserving your seat…
                  </div>
                ) : botUsername ? (
                  <div className="flex justify-center">
                    <TelegramLoginButton
                      botUsername={botUsername}
                      buttonSize="large"
                      mode="guest"
                      onGuestTicket={handleTicket}
                    />
                  </div>
                ) : (
                  <p className="text-center text-sm text-destructive">
                    Telegram login is not configured, so booking is unavailable.
                  </p>
                )}
              </>
            )}
            <Button
              variant="ghost"
              disabled={createBooking.isPending}
              onClick={() => setStep('details')}
            >
              <ArrowLeft data-icon="inline-start" />
              Back
            </Button>
          </div>
        )}

        {step === 'success' && booking && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center gap-2 py-2 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <PartyPopper className="size-6" />
              </span>
              {/*
                Deliberately does not promise a message: the notification worker
                is still a stub (ADR-004), so the management link below is the
                guest's only way back to this booking. Restore the "we've sent
                the details" line when `booking.created` actually dispatches.
              */}
              <p className="text-sm text-muted-foreground text-pretty">
                Your seat is confirmed. Keep the link below to manage it later.
              </p>
            </div>

            <div className="rounded-lg border bg-muted/30 p-4 text-sm">
              <dl className="flex flex-col gap-2">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Service</dt>
                  <dd className="text-right font-medium">{booking.service.title}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">When</dt>
                  <dd className="text-right font-medium">
                    {formatDate(booking.slot.startsAt, booking.organizer.timezone)} ·{' '}
                    {formatTime(booking.slot.startsAt, booking.organizer.timezone)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Name</dt>
                  <dd className="text-right font-medium">{booking.guestName}</dd>
                </div>
                {booking.selectedOptions?.length ? (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Options</dt>
                    <dd className="text-right font-medium">{booking.selectedOptions.join(', ')}</dd>
                  </div>
                ) : null}
                <Separator className="my-1" />
                <div className="flex items-center gap-2 text-primary">
                  <CheckCircle2 className="size-4" />
                  <span className="font-medium">Confirmed</span>
                </div>
              </dl>
            </div>

            <div className="flex flex-col gap-2">
              <AddToCalendar
                title={booking.service.title}
                startsAt={booking.slot.startsAt}
                endsAt={slotEnd(booking.slot)}
                location={effectiveLocation(booking.service, booking.organizer)}
                variant="default"
              />
              {/*
                The real `manageToken` from the response — this link is the
                guest's only way back to the booking if the message is lost.
              */}
              <Button variant="outline" asChild>
                <Link href={`/booking/${booking.manageToken}`}>Manage this booking</Link>
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
