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
  cancelBookingByTokenInput,
  createBookingInput,
  guestBooking,
  lookupBookingByTokenInput,
  lookupBookingsInput,
} from './booking'
import { bookingStatusEnum, messengerEnum, optionsSelectModeEnum } from './enums'
import {
  analyticsServiceCount,
  analyticsSummaryRecord,
  analyticsTrendDay,
  bookingEnvelope,
  bookingsEnvelope,
  cabinetSummaryEnvelope,
  deletedServiceEnvelope,
  deletedSlotEnvelope,
  errorBody,
  guestBookingEnvelope,
  guestBookingsEnvelope,
  internalOrganizerEnvelope,
  internalOrganizerRecord,
  invalidBody,
  organizerEnvelope,
  publicOrganizerViewEnvelope,
  publicServiceViewEnvelope,
  publicSitemapEnvelope,
  serviceCountsRecord,
  serviceEnvelope,
  servicesEnvelope,
  sitemapOrganizerEntry,
  sitemapServiceEntry,
  slotEnvelope,
  slotsEnvelope,
  validationErrors,
} from './envelopes'
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
  registered,
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
  queryLimit,
  queryOffset,
  seats,
  serviceDescription,
  serviceId,
  slug,
  slugShape,
  timezone,
  uuid,
} from './primitives'
import { createServiceInput, serviceRecord, updateServiceInput } from './service'
import {
  avatarContentType,
  avatarUploadSize,
  createAvatarUploadInput,
  createServicePhotoUploadInput,
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

export type WireMeta = {
  id: string
  /**
   * The cross-language validation metadata (ADR-024 C2): what the wire
   * schema expresses beyond JSON Schema, declared once here. `generate:rules`
   * renders it into `validation/rules_gen.py`; the Zod schemas already carry
   * the same behavior (`.trim()`/`.toLowerCase()` in primitives, the
   * `.superRefine` tails), so both sides derive from this one declaration.
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
    transforms?: Record<string, Array<'trim' | 'lowercase'>>
    fieldRules?: Record<
      string,
      Array<'ianaTimezone' | 'slugNotReserved' | 'httpUrl' | 'startsAtNotPast'>
    >
    refinements?: Array<'optionsPair'>
    mergedRequired?: string[]
  }
}

/** Registered schemas keyed by their OpenAPI id — the registry itself. */
export const WIRE_SCHEMAS: Record<string, z.ZodType> = {}

/** Full registration meta keyed by id — the codegen input for rules_gen.py. */
export const WIRE_META: Record<string, WireMeta> = {}

export function register(schema: z.ZodType, meta: WireMeta): void {
  if (WIRE_SCHEMAS[meta.id] !== undefined) {
    throw new Error(`wire: duplicate id "${meta.id}"`)
  }
  // Aliased exports (imageUploadTarget === avatarUploadTarget) are one object;
  // a second id for it would make identity lookup return the wrong meta.
  for (const [existingId, existingSchema] of Object.entries(WIRE_SCHEMAS)) {
    if (existingSchema === schema) {
      throw new Error(
        `wire: schema already registered as "${existingId}" — cannot also register it as "${meta.id}"`,
      )
    }
  }
  WIRE_SCHEMAS[meta.id] = schema
  WIRE_META[meta.id] = meta
}

/**
 * Meta for a registered schema by object identity. Deliberately not a Zod
 * registry lookup: Zod walks a refined schema's parent, so a registry would
 * return `slugShape`'s meta for `slug`.
 */
export function metaOfSchema(schema: z.ZodType): WireMeta | undefined {
  const id = Object.entries(WIRE_SCHEMAS).find(([, s]) => s === schema)?.[0]
  return id === undefined ? undefined : WIRE_META[id]
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
register(avatarContentType, { id: 'ImageContentType' })

// Inputs / updates. `validation` declares what the Zod builders already do
// (ADR-024 C2); the API's decoder consumes it via validation/rules_gen.py.
register(createBookingInput, {
  id: 'CreateBookingInput',
  validation: { transforms: { guestName: ['trim'], selectedOptions: ['trim'] } },
})
register(cancelBookingByTokenInput, { id: 'CancelBookingByTokenInput' })
register(lookupBookingByTokenInput, { id: 'LookupBookingByTokenInput' })
register(lookupBookingsInput, { id: 'LookupBookingsInput' })
register(cancelBookingByOrganizerInput, { id: 'CancelBookingByOrganizerInput' })
register(createServiceInput, {
  id: 'CreateServiceInput',
  validation: {
    transforms: {
      title: ['trim'],
      description: ['trim'],
      location: ['trim'],
      contact: ['trim'],
      defaultPrice: ['trim'],
      options: ['trim'],
    },
    fieldRules: { photoUrl: ['httpUrl'] },
    refinements: ['optionsPair'],
  },
})
register(updateServiceInput, {
  id: 'UpdateServiceInput',
  validation: {
    transforms: {
      title: ['trim'],
      description: ['trim'],
      location: ['trim'],
      contact: ['trim'],
      defaultPrice: ['trim'],
      options: ['trim'],
    },
    fieldRules: { photoUrl: ['httpUrl'] },
    refinements: ['optionsPair'],
    mergedRequired: [
      'title',
      'defaultPrice',
      'defaultCapacity',
      'defaultDurationMinutes',
      'maxSeatsPerBooking',
    ],
  },
})
register(createTimeSlotInput, {
  id: 'CreateTimeSlotInput',
  validation: {
    transforms: { price: ['trim'] },
    fieldRules: { startsAt: ['startsAtNotPast'] },
  },
})
register(updateTimeSlotInput, {
  id: 'UpdateTimeSlotInput',
  validation: {
    transforms: { price: ['trim'] },
    fieldRules: { startsAt: ['startsAtNotPast'] },
    mergedRequired: ['startsAt', 'durationMinutes', 'capacity'],
  },
})
register(registerOrganizerInput, {
  id: 'RegisterOrganizerInput',
  validation: {
    transforms: { slug: ['trim', 'lowercase'], name: ['trim'], contact: ['trim'] },
    fieldRules: { timezone: ['ianaTimezone'], slug: ['slugNotReserved'] },
  },
})
register(internalOrganizerLookupInput, { id: 'InternalOrganizerLookupInput' })
register(updateOrganizerProfileInput, {
  id: 'UpdateOrganizerProfileInput',
  validation: {
    transforms: {
      slug: ['trim', 'lowercase'],
      name: ['trim'],
      description: ['trim'],
      location: ['trim'],
      contact: ['trim'],
    },
    fieldRules: {
      timezone: ['ianaTimezone'],
      slug: ['slugNotReserved'],
      photoUrl: ['httpUrl'],
    },
    mergedRequired: ['name', 'slug', 'timezone'],
  },
})
register(updateOrganizerLanguageInput, { id: 'UpdateOrganizerLanguageInput' })
register(createAvatarUploadInput, { id: 'CreateAvatarUploadInput' })
register(createServicePhotoUploadInput, { id: 'CreateServicePhotoUploadInput' })
register(telegramWidgetPayload, {
  id: 'TelegramWidgetPayload',
  validation: { fieldRules: { photo_url: ['httpUrl'] } },
})

// Records.
// imageUploadTarget and avatarUploadTarget are one object;
// servicePhotoContentType is the same object as avatarContentType:
// identity lookup finds them by reference.
register(organizerProfile, { id: 'OrganizerProfile' })
register(publicOrganizer, { id: 'PublicOrganizer' })
register(serviceRecord, { id: 'ServiceRecord' })
register(timeSlotRecord, { id: 'TimeSlotRecord' })
register(bookingRecord, { id: 'BookingRecord' })
register(guestBooking, { id: 'GuestBooking' })
register(imageUploadTarget, { id: 'ImageUploadTarget' })
register(registeredOrganizer, { id: 'RegisteredOrganizer' })
register(registered, { id: 'Registered' })
register(authTicketPayload, { id: 'AuthTicketPayload' })
register(guestTicketResponse, { id: 'GuestTicketResponse' })
register(authTicketResponse, { id: 'AuthTicketResponse' })
register(loginLinkPayload, { id: 'LoginLinkPayload' })
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
