'use client'

import { ArrowLeft, Minus, Plus } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { OccupancyNotice } from '../use-booking-dialog'
import { LiveOccupancyNotice } from './live-occupancy-notice'

/**
 * Step 3: enter the guest's name and, when the service allows a party, how many
 * seats to claim.
 *
 * The name is optional in the sense that the booking falls back to the Telegram
 * display name, but the field is `required` so the guest is prompted to type
 * something rather than skip it.
 *
 * The seat stepper only appears when there is a party to manage — a
 * solo-only service (the default) never shows it, keeping the common
 * case a single field. It also stays up when live occupancy drops
 * `maxSeats` to 1 under an already-chosen larger party: the minus
 * button is then the guest's way down, hiding the stepper would strand
 * them above the cap. `maxSeats` is already clamped by the caller to
 * `min(service cap, seats left)`, so the guest can never step past what
 * is actually bookable.
 *
 * Live occupancy (ADR-025): when the slot shrinks below the chosen party size
 * the stepper shows the real `seats` value — never a silently clamped one —
 * and `liveNotice` renders the "book what is left" / "pick another slot"
 * choice instead of the submit. Continue stays disabled while a notice is up.
 */
export function DetailsStep({
  name,
  onNameChange,
  seats,
  onSeatsChange,
  maxSeats,
  liveNotice,
  liveSeatsLeft,
  onPickAnotherSlot,
  onConfirmSeats,
  onBack,
  onContinue,
}: {
  name: string
  onNameChange: (name: string) => void
  seats: number
  onSeatsChange: (seats: number) => void
  maxSeats: number
  liveNotice: OccupancyNotice
  liveSeatsLeft: number
  onPickAnotherSlot: () => void
  onConfirmSeats: () => void
  onBack: () => void
  onContinue: () => void
}) {
  const t = useTranslations('Booking')

  // `seats > 1` too: a live shrink can drop maxSeats to 1 under an
  // already-chosen party — the minus button is the only way down.
  const showStepper = maxSeats > 1 || seats > 1
  const canDecrement = seats > 1
  const canIncrement = seats < maxSeats

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onContinue()
      }}
    >
      <FieldGroup>
        {liveNotice && (
          <LiveOccupancyNotice
            notice={liveNotice}
            seatsLeft={liveSeatsLeft}
            onPickAnother={onPickAnotherSlot}
            onConfirmSeats={onConfirmSeats}
          />
        )}
        <Field>
          <FieldLabel htmlFor="guest-name">{t('fullName')}</FieldLabel>
          <Input
            id="guest-name"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder={t('namePlaceholder')}
            required
          />
          <FieldDescription>{t('nameHint')}</FieldDescription>
        </Field>

        {showStepper && (
          <Field>
            <FieldLabel htmlFor="party-size">{t('seats')}</FieldLabel>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => onSeatsChange(seats - 1)}
                disabled={!canDecrement}
                aria-label={t('removeSeat')}
              >
                <Minus />
              </Button>
              <output
                id="party-size"
                aria-live="polite"
                className="w-8 text-center text-lg font-medium tabular-nums"
              >
                {seats}
              </output>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => onSeatsChange(seats + 1)}
                disabled={!canIncrement}
                aria-label={t('addSeat')}
              >
                <Plus />
              </Button>
            </div>
            <FieldDescription>{t('seatsHint', { maxSeats })}</FieldDescription>
          </Field>
        )}

        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={() => onBack()}>
            <ArrowLeft data-icon="inline-start" />
            {t('back')}
          </Button>
          <Button type="submit" className="flex-1" disabled={!!liveNotice}>
            {t('continue')}
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}
