'use client'

import type { PublicOrganizer, ServiceRecord, TimeSlotRecord } from '@repo/contracts'
import { useTranslations } from 'next-intl'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
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
 * each step renders its own component — this shell only wires them together.
 * Controlled by [`BookingFlow`](booking-flow.tsx): exactly one instance per
 * service page, opened by the slot rows' `BookButton`s — and **remounted on
 * every open** (`key={openCount}`), so the hook's initial state always sees
 * the slot the guest just tapped.
 */
export function BookingDialog({
  organizer,
  service,
  slots,
  preselectedSlotId,
  open,
  onOpenChange,
}: {
  organizer: PublicOrganizer
  service: ServiceRecord
  slots: TimeSlotRecord[]
  /** The session to open on — the tapped row's slot, or none for the picker. */
  preselectedSlotId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const booking = useBookingDialog({ service, slots, preselectedSlotId })
  const t = useTranslations('Booking')

  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME
  const maxSeats = booking.maxSeats

  const stepTitles: Record<BookingStep, string> = {
    slot: t('pickTime'),
    options: t('chooseOptions'),
    details: t('yourDetails'),
    verify: t('confirmTelegram'),
    success: t('booked'),
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            isDuplicate={booking.isDuplicate}
            isCreating={booking.isCreating}
            attempted={booking.attempted}
            botUsername={botUsername}
            onTicket={booking.handleTicket}
            onTicketError={booking.handleTicketError}
            onBack={() => booking.setStep('details')}
          />
        )}

        {booking.step === 'success' && booking.booking && <SuccessStep booking={booking.booking} />}
      </DialogContent>
    </Dialog>
  )
}
