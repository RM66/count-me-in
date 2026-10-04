import { z } from 'zod'

import {
  authTicketPayload,
  authTicketResponse,
  guestTicketResponse,
  loginLinkPayload,
  telegramAuthDate,
  telegramHash,
  telegramName,
  telegramOptionalName,
  telegramUserId,
  telegramWidgetPayload,
} from './auth'
import {
  bookingRecord,
  cancelBookingByOrganizerInput,
  createBookingInput,
  guestBooking,
  lookupBookingsInput,
  manageTokenInput,
} from './booking'
import { bookingStatusEnum, messengerEnum, optionsSelectModeEnum } from './enums'
import {
  bookingEnvelope,
  bookingsEnvelope,
  cabinetSummaryEnvelope,
  deletedServiceEnvelope,
  deletedSlotEnvelope,
  guestBookingEnvelope,
  guestBookingsEnvelope,
  internalOrganizerEnvelope,
  organizerEnvelope,
  publicOrganizerViewEnvelope,
  publicServiceViewEnvelope,
  publicSitemapEnvelope,
  registrationResponse,
  serviceEnvelope,
  servicesEnvelope,
  slotEnvelope,
  slotsEnvelope,
} from './envelopes'
import { errorBody, invalidBody, validationErrors } from './errors'
import { appLocaleEnum } from './i18n'
import {
  bookingCancelledJob,
  bookingCreatedJob,
  cancelActorEnum,
  notificationRecipientEnum,
} from './jobs'
import { optionsList, selectedOptionsShape } from './options'
import {
  internalOrganizerLookupInput,
  organizerProfile,
  publicOrganizer,
  registeredOrganizer,
  registerOrganizerInput,
  updateOrganizerLanguageInput,
  updateOrganizerProfileInput,
} from './organizer'
import {
  authTicket,
  capacity,
  contact,
  displayName,
  durationMinutes,
  httpUrl,
  location,
  manageToken,
  maxSeatsPerBooking,
  messengerId,
  optionLabel,
  organizerDescription,
  priceText,
  queryDayKey,
  queryInstant,
  queryLimit,
  queryOffset,
  querySearch,
  seats,
  serviceDescription,
  serviceId,
  slug,
  slugShape,
  timezone,
  uuid,
} from './primitives'
import {
  analyticsServiceCount,
  analyticsSummaryRecord,
  analyticsTrendDay,
  cabinetOverviewRecord,
  internalOrganizerRecord,
  serviceCountsRecord,
  sitemapOrganizerEntry,
  sitemapServiceEntry,
} from './records'
import { createServiceInput, serviceRecord, updateServiceInput } from './service'
import {
  avatarUploadSize,
  createAvatarUploadInput,
  createServicePhotoUploadInput,
  imageContentType,
  imageUploadTarget,
  servicePhotoUploadSize,
} from './storage'
import { createTimeSlotInput, slotStartsAt, timeSlotRecord, updateTimeSlotInput } from './time-slot'

/**
 * The wire registry (ADR-016): every schema that crosses the TS↔Python
 * boundary, registered under the id it carries in the OpenAPI document.
 * The OpenAPI spec is rendered by zod-openapi from this registry alone
 * ([`openapi.ts`](./openapi.ts)), and the API's Pydantic models are
 * generated from the spec by datamodel-code-generator.
 */

type WireTransform = 'trim' | 'lowercase'
type WireFieldRule = 'ianaTimezone' | 'slugNotReserved' | 'httpUrl' | 'startsAtNotPast'
type WireRefinement = 'optionsPair'

export type WireMeta = {
  id: string
  /**
   * JSON payloads that travel outside HTTP (Redis) carry no operation, but
   * they are still on the wire — the generator $refs them under `x-internal`
   * so the orphan check cannot treat them as unused.
   */
  internal?: boolean
  /**
   * The cross-language validation metadata (ADR-024 C2): what the wire
   * schema expresses beyond JSON Schema. For inputs it is **derived** by
   * {@link inputValidation} from the marks the primitives carry, so a new
   * field cannot drift from the primitive it is built from.
   * `generate:rules` renders the result into `validation/rules_gen.py`.
   *
   * - `transforms`: per-property pre-validation transforms applied to the raw
   *   JSON object before schema validation ('trim' = jsTrim on strings and
   *   string arrays, 'lowercase' = toLowerCase on strings).
   * - `fieldRules`: per-property rules the schema cannot express, run when the
   *   property parses to a non-null value ('ianaTimezone', 'slugNotReserved',
   *   'httpUrl', 'startsAtNotPast' — the last is gated on the patch touching
   *   the field in merged-state decode).
   * - `refinements`: object-level cross-field rules ('optionsPair').
   * - `mergedRequired`: update schemas only — the properties the *merged*
   *   state must keep non-null (RFC 7386 null can erase them).
   */
  validation?: {
    transforms?: Record<string, WireTransform[]>
    fieldRules?: Record<string, WireFieldRule[]>
    refinements?: WireRefinement[]
    mergedRequired?: string[]
  }
}

/** Registered schemas keyed by their OpenAPI id — the registry itself. */
export const WIRE_SCHEMAS: Record<string, z.ZodType> = {}

/** Full registration meta keyed by id — the codegen input for rules_gen.py. */
export const WIRE_META: Record<string, WireMeta> = {}

/** Identity index for {@link metaOfSchema}; populated by {@link register}. */
const META_BY_SCHEMA = new Map<z.ZodType, WireMeta>()

export function register(schema: z.ZodType, meta: WireMeta): void {
  if (WIRE_SCHEMAS[meta.id] !== undefined) {
    throw new Error(`wire: duplicate id "${meta.id}"`)
  }
  // One schema object may hold only one wire id — {@link metaOfSchema} is an
  // identity lookup, so a second registration would shadow the first meta.
  const existing = META_BY_SCHEMA.get(schema)
  if (existing !== undefined) {
    throw new Error(
      `wire: schema already registered as "${existing.id}" — cannot also register it as "${meta.id}"`,
    )
  }
  WIRE_SCHEMAS[meta.id] = schema
  WIRE_META[meta.id] = meta
  META_BY_SCHEMA.set(schema, meta)
}

/**
 * Meta for a registered schema by object identity. Deliberately not a Zod
 * registry lookup: Zod walks a refined schema's parent, so a registry would
 * return `slugShape`'s meta for `slug`.
 */
export function metaOfSchema(schema: z.ZodType): WireMeta | undefined {
  return META_BY_SCHEMA.get(schema)
}

// ── Validation derivation ───────────────────────────────────────────────
//
// transforms/fieldRules follow the *primitive*, not the field: a
// `displayName` trims wherever it appears, an `httpUrl` checks its scheme
// wherever it appears. Marks are declared once below — not via Zod
// `.meta()`, which writes into the global registry and would leak into the
// OpenAPI document — and `inputValidation` resolves them through
// optional/nullable wrappers and array elements into per-input metadata.

const PRIMITIVE_VALIDATION = new Map<
  z.ZodType,
  { transforms?: WireTransform[]; fieldRules?: WireFieldRule[] }
>([
  [displayName, { transforms: ['trim'] }],
  [priceText, { transforms: ['trim'] }],
  [organizerDescription, { transforms: ['trim'] }],
  [serviceDescription, { transforms: ['trim'] }],
  [location, { transforms: ['trim'] }],
  [contact, { transforms: ['trim'] }],
  [optionLabel, { transforms: ['trim'] }],
  [slug, { transforms: ['trim', 'lowercase'], fieldRules: ['slugNotReserved'] }],
  [timezone, { fieldRules: ['ianaTimezone'] }],
  [httpUrl, { fieldRules: ['httpUrl'] }],
  [slotStartsAt, { fieldRules: ['startsAtNotPast'] }],
])

/**
 * The marks a property inherits, resolved through optional/nullable/default
 * wrappers and array elements (a `ZodArray`'s `unwrap()` yields its element,
 * which is how `options` picks up `optionLabel`'s trim). A mark found past a
 * `ZodArray` describes the *elements*, so only its transforms carry over — a
 * fieldRule runs on the property value (the list), not on items.
 */
function fieldMarks(
  property: z.ZodType,
): { transforms?: WireTransform[]; fieldRules?: WireFieldRule[] } | undefined {
  let current = property
  let viaArray = false
  for (;;) {
    const marks = PRIMITIVE_VALIDATION.get(current)
    if (marks !== undefined) {
      if (!viaArray) return marks
      return marks.transforms !== undefined ? { transforms: marks.transforms } : undefined
    }
    if (current instanceof z.ZodArray) viaArray = true
    const unwrap = (current as z.ZodType & { unwrap?: () => z.ZodType }).unwrap
    if (unwrap === undefined) return undefined
    current = unwrap.call(current)
  }
}

/**
 * The property map of an object schema. `.refine()`/`.superRefine()` attach
 * checks in Zod 4 and keep the `ZodObject` class, so `.shape` survives —
 * a `.transform()`/`.pipe()` wrapper would fail loudly here instead of
 * silently yielding no metadata.
 */
function shapeOf(schema: z.ZodType): Record<string, z.ZodType> {
  if (!(schema instanceof z.ZodObject)) {
    throw new Error('wire: validation can only be derived from an object schema')
  }
  return schema.shape
}

/**
 * The validation metadata of an input schema, derived from the marks on the
 * primitives its properties are built from. `mergedRequired: true` (update
 * schemas) appends the keys the merged state must keep non-null — exactly the
 * fields that reject `null`, since an explicit `null` in a merge patch would
 * erase them (RFC 7386).
 */
function inputValidation(
  schema: z.ZodType,
  extras: { refinements?: WireRefinement[]; mergedRequired?: boolean } = {},
): WireMeta['validation'] | undefined {
  const shape = shapeOf(schema)
  const transforms: Record<string, WireTransform[]> = {}
  const fieldRules: Record<string, WireFieldRule[]> = {}
  for (const [key, property] of Object.entries(shape)) {
    const marks = fieldMarks(property)
    if (marks?.transforms !== undefined) transforms[key] = marks.transforms
    if (marks?.fieldRules !== undefined) fieldRules[key] = marks.fieldRules
  }
  const validation: NonNullable<WireMeta['validation']> = {}
  if (Object.keys(transforms).length > 0) validation.transforms = transforms
  if (Object.keys(fieldRules).length > 0) validation.fieldRules = fieldRules
  if (extras.refinements !== undefined) validation.refinements = extras.refinements
  if (extras.mergedRequired === true) {
    validation.mergedRequired = Object.entries(shape)
      .filter(([, field]) => !field.safeParse(null).success)
      .map(([key]) => key)
  }
  return Object.keys(validation).length > 0 ? validation : undefined
}

// Primitives.
register(displayName, { id: 'DisplayName' })
register(priceText, { id: 'PriceText' })
register(organizerDescription, { id: 'OrganizerDescription' })
register(serviceDescription, { id: 'ServiceDescription' })
register(location, { id: 'Location' })
register(contact, { id: 'Contact' })
register(optionLabel, { id: 'OptionLabel' })
register(manageToken, { id: 'ManageToken' })
register(messengerId, { id: 'MessengerID' })
register(authTicket, { id: 'AuthTicket' })
register(queryLimit, { id: 'QueryLimit' })
register(queryOffset, { id: 'QueryOffset' })
register(querySearch, { id: 'QuerySearch' })
register(queryDayKey, { id: 'QueryDayKey' })
register(queryInstant, { id: 'QueryInstant' })
register(seats, { id: 'Seats' })
register(capacity, { id: 'Capacity' })
register(durationMinutes, { id: 'DurationMinutes' })
register(maxSeatsPerBooking, { id: 'MaxSeatsPerBooking' })
register(avatarUploadSize, { id: 'AvatarUploadSize' })
register(servicePhotoUploadSize, { id: 'ServicePhotoUploadSize' })
register(uuid, { id: 'UUID' })
register(serviceId, { id: 'ServiceID' })
register(slugShape, { id: 'SlugShape' })
register(slug, { id: 'Slug' })
register(timezone, { id: 'Timezone' })
register(httpUrl, { id: 'URL' })
register(slotStartsAt, { id: 'SlotStartsAt' })
register(optionsList, { id: 'OptionsList' })
register(selectedOptionsShape, { id: 'SelectedOptions' })
register(telegramUserId, { id: 'TelegramUserID' })
register(telegramAuthDate, { id: 'TelegramAuthDate' })
register(telegramName, { id: 'TelegramName' })
register(telegramOptionalName, { id: 'TelegramOptionalName' })
register(telegramHash, { id: 'TelegramHash' })

// Enums.
register(bookingStatusEnum, { id: 'BookingStatus' })
register(messengerEnum, { id: 'Messenger' })
register(optionsSelectModeEnum, { id: 'OptionsSelectMode' })
register(notificationRecipientEnum, { id: 'NotificationRecipient' })
register(cancelActorEnum, { id: 'CancelActor' })
register(appLocaleEnum, { id: 'AppLocale' })
register(imageContentType, { id: 'ImageContentType' })

// Inputs / updates. `validation` is derived from the primitive marks above
// (ADR-024 C2); the API's decoder consumes the result via
// validation/rules_gen.py. Update schemas add `mergedRequired`, computed
// straight off their own shape.
register(createBookingInput, {
  id: 'CreateBookingInput',
  validation: inputValidation(createBookingInput),
})
register(manageTokenInput, { id: 'ManageTokenInput' })
register(lookupBookingsInput, { id: 'LookupBookingsInput' })
register(cancelBookingByOrganizerInput, { id: 'CancelBookingByOrganizerInput' })
register(createServiceInput, {
  id: 'CreateServiceInput',
  validation: inputValidation(createServiceInput, { refinements: ['optionsPair'] }),
})
register(updateServiceInput, {
  id: 'UpdateServiceInput',
  validation: inputValidation(updateServiceInput, {
    refinements: ['optionsPair'],
    mergedRequired: true,
  }),
})
register(createTimeSlotInput, {
  id: 'CreateTimeSlotInput',
  validation: inputValidation(createTimeSlotInput),
})
register(updateTimeSlotInput, {
  id: 'UpdateTimeSlotInput',
  validation: inputValidation(updateTimeSlotInput, { mergedRequired: true }),
})
register(registerOrganizerInput, {
  id: 'RegisterOrganizerInput',
  validation: inputValidation(registerOrganizerInput),
})
register(internalOrganizerLookupInput, { id: 'InternalOrganizerLookupInput' })
register(updateOrganizerProfileInput, {
  id: 'UpdateOrganizerProfileInput',
  validation: inputValidation(updateOrganizerProfileInput, { mergedRequired: true }),
})
register(updateOrganizerLanguageInput, { id: 'UpdateOrganizerLanguageInput' })
register(createAvatarUploadInput, { id: 'CreateAvatarUploadInput' })
register(createServicePhotoUploadInput, { id: 'CreateServicePhotoUploadInput' })
register(telegramWidgetPayload, {
  id: 'TelegramWidgetPayload',
  validation: inputValidation(telegramWidgetPayload),
})

// Records.
register(organizerProfile, { id: 'OrganizerProfile' })
register(publicOrganizer, { id: 'PublicOrganizer' })
register(serviceRecord, { id: 'ServiceRecord' })
register(timeSlotRecord, { id: 'TimeSlotRecord' })
register(bookingRecord, { id: 'BookingRecord' })
register(guestBooking, { id: 'GuestBooking' })
register(imageUploadTarget, { id: 'ImageUploadTarget' })
register(registeredOrganizer, { id: 'RegisteredOrganizer' })
register(registrationResponse, { id: 'RegistrationResponse' })
register(authTicketPayload, { id: 'AuthTicketPayload', internal: true })
register(guestTicketResponse, { id: 'GuestTicketResponse' })
register(authTicketResponse, { id: 'AuthTicketResponse' })
register(loginLinkPayload, { id: 'LoginLinkPayload', internal: true })
register(bookingCreatedJob, { id: 'BookingCreatedJob' })
register(bookingCancelledJob, { id: 'BookingCancelledJob' })

// Response envelopes — last.
register(serviceEnvelope, { id: 'ServiceEnvelope' })
register(servicesEnvelope, { id: 'ServicesEnvelope' })
register(slotEnvelope, { id: 'SlotEnvelope' })
register(slotsEnvelope, { id: 'SlotsEnvelope' })
register(guestBookingEnvelope, { id: 'GuestBookingEnvelope' })
register(bookingEnvelope, { id: 'BookingEnvelope' })
register(bookingsEnvelope, { id: 'BookingsEnvelope' })
register(guestBookingsEnvelope, { id: 'GuestBookingsEnvelope' })
register(organizerEnvelope, { id: 'OrganizerEnvelope' })
register(publicOrganizerViewEnvelope, { id: 'PublicOrganizerViewEnvelope' })
register(publicServiceViewEnvelope, { id: 'PublicServiceViewEnvelope' })
register(sitemapOrganizerEntry, { id: 'SitemapOrganizerEntry' })
register(sitemapServiceEntry, { id: 'SitemapServiceEntry' })
register(publicSitemapEnvelope, { id: 'PublicSitemapEnvelope' })
register(serviceCountsRecord, { id: 'ServiceCountsRecord' })
register(cabinetOverviewRecord, { id: 'CabinetOverviewRecord' })
register(analyticsTrendDay, { id: 'AnalyticsTrendDay' })
register(analyticsServiceCount, { id: 'AnalyticsServiceCount' })
register(analyticsSummaryRecord, { id: 'AnalyticsSummaryRecord' })
register(cabinetSummaryEnvelope, { id: 'CabinetSummaryEnvelope' })
register(internalOrganizerRecord, { id: 'InternalOrganizerRecord' })
register(internalOrganizerEnvelope, { id: 'InternalOrganizerEnvelope' })
register(deletedServiceEnvelope, { id: 'DeletedServiceEnvelope' })
register(deletedSlotEnvelope, { id: 'DeletedSlotEnvelope' })
register(errorBody, { id: 'ErrorBody' })
register(validationErrors, { id: 'ValidationErrors' })
register(invalidBody, { id: 'InvalidBody' })
