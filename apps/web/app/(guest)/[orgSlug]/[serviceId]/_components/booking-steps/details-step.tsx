'use client'

import { ArrowLeft } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

/**
 * Step 3: enter the guest's name.
 *
 * The name is optional in the sense that the booking falls back to the Telegram
 * display name, but the field is `required` so the guest is prompted to type
 * something rather than skip it.
 */
export function DetailsStep({
  name,
  onNameChange,
  onBack,
  onContinue,
}: {
  name: string
  onNameChange: (name: string) => void
  onBack: () => void
  onContinue: () => void
}) {
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
