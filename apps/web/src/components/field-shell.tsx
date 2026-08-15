'use client'

import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'

/**
 * Wraps a form field in the invalid-state plumbing: `data-invalid` on the
 * `Field` (styles the label and description) *and* `aria-invalid` on the control
 * (styles the control and announces it to assistive tech). Written once here so
 * it cannot be forgotten when a field is added.
 *
 * Shared by the slot and service form fields — both need the same label +
 * description + error layout around a single control.
 */
export function FieldShell({
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
