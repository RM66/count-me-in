'use client'

import type { ComponentProps } from 'react'
import type { Control, FieldPath, FieldValues } from 'react-hook-form'
import { useController } from 'react-hook-form'

import { FieldShell } from '@/components/field-shell'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

/**
 * The plain-input form fields used across the cabinet. Validation lives in
 * the caller's schema — these components only own the FieldShell + invalid
 * plumbing around the control.
 *
 * `id` defaults to `name`; pass `idPrefix` when a page mounts more than one
 * form so the label targets stay unique (the slot dialog uses `slot-`).
 */
type SharedFieldProps<V extends FieldValues, C, O> = {
  control: Control<V, C, O>
  name: FieldPath<V>
  label: string
  description?: string
  disabled?: boolean
  idPrefix?: string
}

/** Single-line text, number, date or time field. */
export function FormTextField<V extends FieldValues, C, O>({
  control,
  name,
  label,
  description,
  disabled,
  idPrefix,
  ...inputProps
}: SharedFieldProps<V, C, O> &
  Pick<ComponentProps<typeof Input>, 'placeholder' | 'type' | 'min' | 'inputMode'>) {
  const { field, fieldState } = useController({ control, name })
  const id = `${idPrefix ?? ''}${name}`

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

/** Multi-line text field. */
export function FormTextareaField<V extends FieldValues, C, O>({
  control,
  name,
  label,
  description,
  disabled,
  idPrefix,
  ...textareaProps
}: SharedFieldProps<V, C, O> & Pick<ComponentProps<typeof Textarea>, 'placeholder' | 'rows'>) {
  const { field, fieldState } = useController({ control, name })
  const id = `${idPrefix ?? ''}${name}`

  return (
    <FieldShell
      htmlFor={id}
      label={label}
      description={description}
      invalid={fieldState.invalid}
      error={fieldState.error}
    >
      <Textarea
        {...field}
        {...textareaProps}
        id={id}
        disabled={disabled}
        aria-invalid={fieldState.invalid || undefined}
      />
    </FieldShell>
  )
}
