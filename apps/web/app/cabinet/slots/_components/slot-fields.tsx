'use client'

import type { ServiceRecord } from '@repo/api-contracts'
import type { ComponentProps } from 'react'
import { useController } from 'react-hook-form'

import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { SlotFormControl, SlotTextFieldName } from './use-slot-form'

/**
 * Wraps a field in the invalid-state plumbing: `data-invalid` on the `Field`
 * (styles the label and description) *and* `aria-invalid` on the control
 * (styles the control and announces it to assistive tech). Written once here so
 * it cannot be forgotten when a field is added.
 *
 * The ids are prefixed `slot-` because this form renders inside a dialog on a
 * page that already has controls of its own.
 */
function FieldShell({
  htmlFor,
  label,
  description,
  invalid,
  error,
  children,
}: {
  htmlFor: string
  label: string
  description?: string
  invalid: boolean
  error?: { message?: string }
  children: React.ReactNode
}) {
  return (
    <Field data-invalid={invalid || undefined}>
      <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
      {children}
      {description && <FieldDescription>{description}</FieldDescription>}
      <FieldError errors={error ? [error] : undefined} />
    </Field>
  )
}

/** Single-line text, date, time or number field. */
export function SlotTextField({
  control,
  name,
  label,
  description,
  disabled,
  ...inputProps
}: {
  control: SlotFormControl
  name: SlotTextFieldName
  label: string
  description?: string
  disabled?: boolean
} & Pick<ComponentProps<typeof Input>, 'placeholder' | 'type' | 'min' | 'inputMode'>) {
  const { field, fieldState } = useController({ control, name })
  const id = `slot-${name}`

  return (
    <FieldShell
      htmlFor={id}
      label={label}
      description={description}
      invalid={fieldState.invalid}
      error={fieldState.error}
    >
      <Input
        {...field}
        {...inputProps}
        id={id}
        disabled={disabled}
        aria-invalid={fieldState.invalid || undefined}
      />
    </FieldShell>
  )
}

/**
 * Service picker.
 *
 * `onSelect` is the form hook's `selectService` rather than the raw field
 * `onChange`: choosing a service also re-seeds capacity and duration from that
 * service's defaults, which is a form rule, not a rendering one.
 */
export function SlotServiceField({
  control,
  services,
  onSelect,
  disabled,
}: {
  control: SlotFormControl
  services: ServiceRecord[]
  onSelect: (serviceId: string) => void
  disabled?: boolean
}) {
  const { field, fieldState } = useController({ control, name: 'serviceId' })

  return (
    <FieldShell
      htmlFor="slot-serviceId"
      label="Service"
      invalid={fieldState.invalid}
      error={fieldState.error}
    >
      <Select value={field.value} onValueChange={onSelect} disabled={disabled}>
        <SelectTrigger
          id="slot-serviceId"
          className="w-full"
          aria-invalid={fieldState.invalid || undefined}
        >
          <SelectValue placeholder="Select a service" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {services.map((service) => (
              <SelectItem key={service.id} value={service.id}>
                {service.title}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </FieldShell>
  )
}
