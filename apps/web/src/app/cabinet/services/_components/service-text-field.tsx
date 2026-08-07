'use client'

import type { ComponentProps } from 'react'
import { useController } from 'react-hook-form'

import { FieldShell } from '@/components/field-shell'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { ServiceFormControl, ServiceTextFieldName } from './use-service-form'

type SharedProps = {
  control: ServiceFormControl
  name: ServiceTextFieldName
  label: string
  description?: string
  disabled?: boolean
}

/** Single-line text or number field. */
export function ServiceTextField({
  control,
  name,
  label,
  description,
  disabled,
  ...inputProps
}: SharedProps & Pick<ComponentProps<typeof Input>, 'placeholder' | 'type' | 'min' | 'inputMode'>) {
  const { field, fieldState } = useController({ control, name })

  return (
    <FieldShell
      htmlFor={name}
      label={label}
      description={description}
      invalid={fieldState.invalid}
      error={fieldState.error}
    >
      <Input
        {...field}
        {...inputProps}
        id={name}
        disabled={disabled}
        aria-invalid={fieldState.invalid || undefined}
      />
    </FieldShell>
  )
}

/** Multi-line text field. */
export function ServiceTextareaField({
  control,
  name,
  label,
  description,
  disabled,
  ...textareaProps
}: SharedProps & Pick<ComponentProps<typeof Textarea>, 'placeholder' | 'rows'>) {
  const { field, fieldState } = useController({ control, name })

  return (
    <FieldShell
      htmlFor={name}
      label={label}
      description={description}
      invalid={fieldState.invalid}
      error={fieldState.error}
    >
      <Textarea
        {...field}
        {...textareaProps}
        id={name}
        disabled={disabled}
        aria-invalid={fieldState.invalid || undefined}
      />
    </FieldShell>
  )
}
