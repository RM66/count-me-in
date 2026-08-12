'use client'

import type { ServiceRecord } from '@repo/contracts'
import type { ComponentProps } from 'react'
import { useController } from 'react-hook-form'

import { FieldShell } from '@/components/field-shell'
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
