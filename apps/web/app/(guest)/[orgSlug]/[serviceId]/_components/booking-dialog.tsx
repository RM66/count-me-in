'use client'

import type { PublicOrganizer, ServiceRecord, TimeSlotRecord } from '@repo/api-contracts'
import { seatsLeft } from '@repo/api-contracts'
import { type ComponentProps, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { DetailsStep } from './booking-steps/details-step'
import { OptionsStep } from './booking-steps/options-step'
import { SlotStep } from './booking-steps/slot-step'
import { SuccessStep } from './booking-steps/success-step'
import { VerifyStep } from './booking-steps/verify-step'
import { type BookingStep, useBookingDialog } from './use-booking-dialog'

/**
 * The guest booking flow (docs/pages.md): pick slot → options → name → Telegram
 * → confirmation, as a stepper inside one dialog rather than separate routes.
 *
 * The state machine lives in [`useBookingDialog`](use-booking-dialog.ts) and
 * each step renders its own component — this shell only wires them together and
 * owns the dialog's open/close + reset lifecycle.
 */

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
  const [open, setOpen] = useState(false)
  const booking = useBookingDialog({ service, preselectedSlotId })

  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME

  // The seat ceiling for the chosen slot: the organizer's per-booking cap, but
  // never more than the seats actually left. Falls back to the service cap
  // before a slot is picked (the details step is only reached with one).
  const selectedSlot = booking.slotId ? slots.find((s) => s.id === booking.slotId) : undefined
  const maxSeats = Math.max(
    1,
    selectedSlot
      ? Math.min(service.maxSeatsPerBooking, seatsLeft(selectedSlot))
      : service.maxSeatsPerBooking,
  )

  const stepTitles: Record<BookingStep, string> = {
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
        if (!o) setTimeout(booking.reset, 200)
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
          <DialogTitle>{stepTitles[booking.step]}</DialogTitle>
          <DialogDescription>{service.title}</DialogDescription>
        </DialogHeader>

        {booking.step === 'slot' && (
          <SlotStep
            slots={slots}
            organizer={organizer}
            service={service}
            slotId={booking.slotId}
            onSlotChange={booking.setSlotId}
            onContinue={booking.goFromSlot}
          />
        )}

        {booking.step === 'options' && (
          <OptionsStep
            service={service}
            selectedOptions={booking.selectedOptions}
            onToggleOption={booking.toggleOption}
            onBack={() => booking.setStep('slot')}
            onContinue={() => booking.setStep('details')}
          />
        )}

        {booking.step === 'details' && (
          <DetailsStep
            name={booking.name}
            onNameChange={booking.setName}
            seats={booking.seats}
            onSeatsChange={booking.setSeats}
            maxSeats={maxSeats}
            onBack={() => booking.setStep(service.options?.length ? 'options' : 'slot')}
            onContinue={() => booking.setStep('verify')}
          />
        )}

        {booking.step === 'verify' && (
          <VerifyStep
            organizer={organizer}
            error={booking.error}
            isCreating={booking.isCreating}
            botUsername={botUsername}
            onTicket={booking.handleTicket}
            onBack={() => booking.setStep('details')}
          />
        )}

        {booking.step === 'success' && booking.booking && <SuccessStep booking={booking.booking} />}
      </DialogContent>
    </Dialog>
  )
}
