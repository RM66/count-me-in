import { z } from 'zod'

import { optionsSelectModeEnum } from './enums'
import {
  capacity,
  contact,
  displayName,
  durationMinutes,
  location,
  optionLabel,
  priceText,
  serviceDescription,
} from './primitives'
import type { CreateServiceInput, ServiceRecord } from './service'

/**
 * The cabinet service form, as the *inputs* hold it — deliberately distinct from
 * {@link CreateServiceInput} / {@link UpdateServiceInput}.
 *
 * Three reasons the wire schemas cannot be reused directly as a form resolver:
 * 1. A controlled number input yields a `string`, including `''` mid-edit.
 * 2. An untouched optional text input is `''`, which must reach the API as
 *    `null` (clear the column) rather than an empty string.
 * 3. Create takes `optional` while update takes `nullable`, so neither shape
 *    fits a form that drives both.
 *
 * Every rule is composed from the same primitives the wire schemas use, so
 * bounds cannot drift between client and server.
 */

/** Optional text field: `''` (untouched or cleared) → `null`, otherwise validated. */
function optionalText<T extends z.ZodType<string, string>>(schema: T) {
  return z.union([z.literal(''), schema]).transform((value) => (value === '' ? null : value))
}

/**
 * Numeric text field. `z.coerce.number()` would turn `''` into `0` and report
 * "too small" for an empty input, so the empty case is rejected explicitly and
 * anything non-numeric is caught before the primitive's bounds apply.
 */
function numericText<T extends z.ZodType<number, number>>(schema: T, label: string) {
  return (
    z
      .string()
      .trim()
      .min(1, `${label} is required`)
      .transform((value) => Number(value))
      // `z.number()` rejects NaN, which is what a non-numeric input becomes.
      .pipe(z.number({ error: `${label} must be a number` }).pipe(schema))
  )
}

const serviceFormFields = {
  title: displayName,
  description: optionalText(serviceDescription),
  location: optionalText(location),
  contact: optionalText(contact),
  defaultPrice: priceText,
  defaultCapacity: numericText(capacity, 'Capacity'),
  defaultDurationMinutes: numericText(durationMinutes, 'Duration'),
  /**
   * Uniqueness is enforced here rather than by reusing `optionsList`: that
   * schema also requires `.min(1)`, while an empty form list is legal and simply
   * means "this service has no options".
   */
  options: z
    .array(optionLabel)
    .max(50)
    .refine((values) => new Set(values).size === values.length, {
      message: 'options must be unique',
    }),
  optionsSelectMode: optionsSelectModeEnum,
  photoUrl: z.url().nullable(),
}

/**
 * Validates the form and normalizes it into the wire shape.
 *
 * `options` and `optionsSelectMode` always travel together — the wire contract
 * rejects a mode without options and vice versa — so an empty list clears both.
 */
export const serviceFormSchema = z
  .object(serviceFormFields)
  .transform(({ options, optionsSelectMode, ...rest }) => ({
    ...rest,
    options: options.length > 0 ? options : null,
    optionsSelectMode: options.length > 0 ? optionsSelectMode : null,
  }))

/** What the inputs hold (all strings). Use for `useForm` values and defaults. */
export type ServiceFormValues = z.input<typeof serviceFormSchema>

/**
 * What a valid submit produces: parsed, trimmed, `''` collapsed to `null`.
 *
 * This is already a valid `UpdateServiceInput` — that contract is `.partial()`
 * and nullable, so `null` clears a column and re-sending an unchanged value is a
 * no-op write. No update-side conversion is needed; dirty-field tracking belongs
 * in the UI (to enable/disable Save), not in the payload.
 */
export type ServiceFormOutput = z.output<typeof serviceFormSchema>

/** Defaults for a brand-new service. */
const NEW_SERVICE_DEFAULTS = {
  capacity: '10',
  durationMinutes: '60',
} as const

/**
 * Seed the form from an existing service, or from defaults when creating.
 *
 * Pure and dependency-free so it can be unit tested and reused by any surface
 * that needs to render this form.
 */
export function toServiceFormValues(service?: ServiceRecord): ServiceFormValues {
  return {
    title: service?.title ?? '',
    description: service?.description ?? '',
    location: service?.location ?? '',
    contact: service?.contact ?? '',
    defaultPrice: service?.defaultPrice ?? '',
    defaultCapacity: String(service?.defaultCapacity ?? NEW_SERVICE_DEFAULTS.capacity),
    defaultDurationMinutes: String(
      service?.defaultDurationMinutes ?? NEW_SERVICE_DEFAULTS.durationMinutes,
    ),
    options: service?.options ?? [],
    // Only meaningful once options exist; `single` is the harmless default.
    optionsSelectMode: service?.optionsSelectMode ?? 'single',
    photoUrl: service?.photoUrl ?? null,
  }
}

/**
 * Narrow the form output to the create contract by dropping `null`s: create
 * takes `optional` fields, and an absent key is how "not set" is expressed.
 */
export function toCreateServiceInput(values: ServiceFormOutput): CreateServiceInput {
  return {
    title: values.title,
    defaultPrice: values.defaultPrice,
    defaultCapacity: values.defaultCapacity,
    defaultDurationMinutes: values.defaultDurationMinutes,
    ...(values.description !== null && { description: values.description }),
    ...(values.location !== null && { location: values.location }),
    ...(values.contact !== null && { contact: values.contact }),
    ...(values.photoUrl !== null && { photoUrl: values.photoUrl }),
    ...(values.options !== null && {
      options: values.options,
      optionsSelectMode: values.optionsSelectMode ?? undefined,
    }),
  }
}
