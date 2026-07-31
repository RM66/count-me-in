'use client'

import type { ComponentProps } from 'react'
import { useController } from 'react-hook-form'

import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
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

/**
 * Wraps a field in the invalid-state plumbing: `data-invalid` on the `Field`
 * (styles the label and description) *and* `aria-invalid` on the control (styles
 * the control and announces it to assistive tech). Written once here so it
 * cannot be forgotten when a field is added.
 */
function FieldShell({
  name,
  label,
  description,
  invalid,
  error,
  children,
}: Pick<SharedProps, 'name' | 'label' | 'description'> & {
  invalid: boolean
  error?: { message?: string }
  children: React.ReactNode
}) {
  return (
    <Field data-invalid={invalid || undefined}>
      <FieldLabel htmlFor={name}>{label}</FieldLabel>
      {children}
      {description && <FieldDescription>{description}</FieldDescription>}
      <FieldError errors={error ? [error] : undefined} />
    </Field>
  )
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
      name={name}
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
      name={name}
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
