'use client'

import { ArrowLeft, Minus, Plus } from 'lucide-react'
import { useEffect } from 'react'

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
  const showStepper = maxSeats > 1
  // Guard against a stale value if the selected slot lost seats between steps.
  const clamped = Math.min(Math.max(1, seats), maxSeats)
  const canDecrement = clamped > 1
  const canIncrement = clamped < maxSeats

  // Keep the hook's `seats` in sync when the clamp actually changed it — e.g.
  // the guest picked a party of 4, then went back and chose a slot with 2 left.
  // Without this the display would show 2 but the request would still send 4.
  useEffect(() => {
    if (clamped !== seats) onSeatsChange(clamped)
  }, [clamped, seats, onSeatsChange])

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onContinue()
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="guest-name">Full name</FieldLabel>
          <Input
            id="guest-name"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Mila Petrović"
            required
          />
          <FieldDescription>The name the organizer will see on their list.</FieldDescription>
        </Field>

        {showStepper && (
          <Field>
            <FieldLabel htmlFor="party-size">Seats</FieldLabel>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => onSeatsChange(clamped - 1)}
                disabled={!canDecrement}
                aria-label="Remove a seat"
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
                aria-label="Add a seat"
              >
                <Plus />
              </Button>
            </div>
            <FieldDescription>
              Including you. Up to {maxSeats} {maxSeats === 1 ? 'seat' : 'seats'} on this session.
            </FieldDescription>
          </Field>
        )}

        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={() => onBack()}>
            <ArrowLeft data-icon="inline-start" />
            Back
          </Button>
          <Button type="submit" className="flex-1">
            Continue
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}
