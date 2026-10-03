import { z } from 'zod'

import { optionsSelectModeEnum } from './enums'
import { numericText, optionalText } from './form-fields'
import { uniqueOptionLabels } from './options'
import {
  capacity,
  contact,
  displayName,
  durationMinutes,
  httpUrl,
  location,
  maxSeatsPerBooking,
  priceText,
  serviceDescription,
} from './primitives'
import type { CreateServiceInput, ServiceRecord, UpdateServiceInput } from './service'
import { SERVICE_DEFAULTS } from './service'

/**
 * The cabinet service form, as the *inputs* hold it — deliberately distinct
 * from {@link CreateServiceInput} / {@link UpdateServiceInput}.
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

const serviceFormFields = {
  title: displayName,
  description: optionalText(serviceDescription),
  location: optionalText(location),
  contact: optionalText(contact),
  defaultPrice: priceText,
  defaultCapacity: numericText(capacity, 'Capacity'),
  defaultDurationMinutes: numericText(durationMinutes, 'Duration'),
  maxSeatsPerBooking: numericText(maxSeatsPerBooking, 'Max seats per booking'),
  /**
   * The wire's `optionsList` requires `.min(1)`; the form shares its base
   * {@link uniqueOptionLabels} instead — an empty list is legal input and
   * simply means "this service has no options".
   */
  options: uniqueOptionLabels(),
  optionsSelectMode: optionsSelectModeEnum,
  photoUrl: httpUrl.nullable(),
}

/**
 * Validates the form and normalizes it into the wire shape.
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
 * Not sent to the update endpoint as-is — `toUpdateServiceInput` diffs it
 * against the stored record first (merge-patch counts every arriving key
 * as a changed column).
 */
export type ServiceFormOutput = z.output<typeof serviceFormSchema>

/**
 * Seed the form from an existing service, or from defaults when creating.
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
    defaultCapacity: String(service?.defaultCapacity ?? SERVICE_DEFAULTS.capacity),
    defaultDurationMinutes: String(
      service?.defaultDurationMinutes ?? SERVICE_DEFAULTS.durationMinutes,
    ),
    maxSeatsPerBooking: String(service?.maxSeatsPerBooking ?? SERVICE_DEFAULTS.maxSeatsPerBooking),
    options: service?.options ?? [],
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
    maxSeatsPerBooking: values.maxSeatsPerBooking,
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

/** `null` and `[]` both mean "no options" — normalize before comparing. */
function sameOptionList(a: readonly string[] | null, b: readonly string[] | null): boolean {
  const left = a && a.length > 0 ? a : null
  const right = b && b.length > 0 ? b : null
  if (left === null || right === null) return left === right
  return left.length === right.length && left.every((value, i) => value === right[i])
}

/**
 * Narrow the form output to the update contract — a **value diff** against
 * the stored service, not the whole record. Merge-patch counts every arriving
 * key as a changed column: re-sending an unchanged `photoUrl` would trigger
 * the replaced-media cleanup on every save, and a resend of `options` would
 * still have to drag `optionsSelectMode` along — the wire validates the pair
 * on the patch, not the merged row, so the pair is emitted together when
 * either half changed.
 *
 * An empty result means "nothing changed" — the caller must not send it:
 * an empty patch is a 400.
 */
export function toUpdateServiceInput(
  values: ServiceFormOutput,
  service: ServiceRecord,
): UpdateServiceInput {
  const patch: UpdateServiceInput = {}
  if (values.title !== service.title) patch.title = values.title
  if (values.description !== service.description) patch.description = values.description
  if (values.location !== service.location) patch.location = values.location
  if (values.contact !== service.contact) patch.contact = values.contact
  if (values.defaultPrice !== service.defaultPrice) patch.defaultPrice = values.defaultPrice
  if (values.defaultCapacity !== service.defaultCapacity) {
    patch.defaultCapacity = values.defaultCapacity
  }
  if (values.defaultDurationMinutes !== service.defaultDurationMinutes) {
    patch.defaultDurationMinutes = values.defaultDurationMinutes
  }
  if (values.maxSeatsPerBooking !== service.maxSeatsPerBooking) {
    patch.maxSeatsPerBooking = values.maxSeatsPerBooking
  }
  if (values.photoUrl !== service.photoUrl) patch.photoUrl = values.photoUrl
  if (
    !sameOptionList(values.options, service.options) ||
    values.optionsSelectMode !== service.optionsSelectMode
  ) {
    patch.options = values.options
    patch.optionsSelectMode = values.optionsSelectMode
  }
  return patch
}
