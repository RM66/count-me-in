'use client'

import type { PublicOrganizer, ServiceRecord, TimeSlotRecord } from '@repo/contracts'
import { useTranslations } from 'next-intl'
import { useEffect } from 'react'

import { loadTelegramLoginScript } from '@/components/telegram-inapp'
import { isTelegramWebView } from '@/components/telegram-oidc'
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
 *
 * `slots` is the *live* list (SSE-patched query from BookingFlow, ADR-025),
 * so `booking.liveNotice` tracks a slot that fills or shrinks mid-flow: each
 * step gets the notice relevant to it — the options step only cares that the
 * slot is gone, details/verify also guard the chosen party size.
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

  const clientId = process.env.NEXT_PUBLIC_TELEGRAM_CLIENT_ID
  const maxSeats = booking.maxSeats

  // Warm the telegram-login.js fetch while the guest picks a slot — only
  // the in-app WebView branch needs the lib, and its oauth_supported
  // handshake takes a beat (ADR-026). Safe to race ahead of the button:
  // the loader installs the receiveEvent observer itself, so the
  // one-shot oauth_supported is captured module-side, not consumed here.
  useEffect(() => {
    if (open && isTelegramWebView()) void loadTelegramLoginScript().catch(() => {})
  }, [open])

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
            liveNotice={booking.liveNotice === 'filled' ? 'filled' : null}
            onPickAnotherSlot={booking.pickAnotherSlot}
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
            liveNotice={booking.liveNotice}
            liveSeatsLeft={booking.liveSeatsLeft}
            onPickAnotherSlot={booking.pickAnotherSlot}
            onConfirmSeats={booking.bookRemainingSeats}
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
            liveNotice={booking.liveNotice}
            liveSeatsLeft={booking.liveSeatsLeft}
            onPickAnotherSlot={booking.pickAnotherSlot}
            onConfirmSeats={booking.bookRemainingSeats}
            clientId={clientId}
            onTicket={booking.handleTicket}
            onTicketError={booking.handleTicketError}
            onBack={booking.backFromVerify}
          />
        )}

        {booking.step === 'success' && booking.booking && <SuccessStep booking={booking.booking} />}
      </DialogContent>
    </Dialog>
  )
}
