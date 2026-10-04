'use client'

import { ArrowLeft, Minus, Plus } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

/**
 * Step 3: enter the guest's name and, when the service allows a party, how many
 * seats to claim.
 *
 * The name is optional in the sense that the booking falls back to the Telegram
 * display name, but the field is `required` so the guest is prompted to type
 * something rather than skip it.
 *
 * The seat stepper only appears when `maxSeats > 1` — a solo-only service (the
 * default) never shows it, keeping the common case a single field. `maxSeats`
 * is already clamped by the caller to `min(service cap, seats left)`, so the
 * guest can never step past what is actually bookable.
 */
export function DetailsStep({
  name,
  onNameChange,
  seats,
  onSeatsChange,
  maxSeats,
  onBack,
  onContinue,
}: {
  name: string
  onNameChange: (name: string) => void
  seats: number
  onSeatsChange: (seats: number) => void
  maxSeats: number
  onBack: () => void
  onContinue: () => void
}) {
  const t = useTranslations('Booking')

  const showStepper = maxSeats > 1
  // The hook clamps `seats` on slot change and at submit; this is display-only
  // defense for a standalone render with a stale value.
  const clamped = Math.min(Math.max(1, seats), maxSeats)
  const canDecrement = clamped > 1
  const canIncrement = clamped < maxSeats

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onContinue()
      }}
    >
      <FieldGroup>
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
                onClick={() => onSeatsChange(clamped - 1)}
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
                {clamped}
              </output>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => onSeatsChange(clamped + 1)}
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
          <Button type="submit" className="flex-1">
            {t('continue')}
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}
