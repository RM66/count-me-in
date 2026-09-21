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
  lookupBookingsInput,
} from './booking'
import { bookingStatusEnum, messengerEnum, optionsSelectModeEnum } from './enums'
import {
  bookingEnvelope,
  deletedServiceEnvelope,
  deletedSlotEnvelope,
  errorBody,
  guestBookingEnvelope,
  guestBookingsEnvelope,
  invalidBody,
  invalidIssuesBody,
  organizerEnvelope,
  serviceEnvelope,
  servicesEnvelope,
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
 * The wire registry (ADR-016): every schema that crosses the TS↔Go boundary,
 * registered under the id it carries in the OpenAPI document. The old
 * `x-go-*` metadata and the `kind` tags fed the retired hand-written
 * generator; the OpenAPI spec is now rendered by zod-openapi from this
 * registry alone ([`openapi.ts`](./openapi.ts)), and the Go side is
 * generated from the spec by oapi-codegen.
 */

export type WireMeta = {
  id: string
}

/** Registered schemas keyed by their OpenAPI id — the registry itself. */
export const WIRE_SCHEMAS: Record<string, z.ZodType> = {}

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
}

/**
 * Meta for a registered schema by object identity. Deliberately not a Zod
 * registry lookup: Zod walks a refined schema's parent, so a registry would
 * return `slugShape`'s meta for `slug`.
 */
export function metaOfSchema(schema: z.ZodType): WireMeta | undefined {
  const id = Object.entries(WIRE_SCHEMAS).find(([, s]) => s === schema)?.[0]
  return id === undefined ? undefined : { id }
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

// Inputs / updates.
register(createBookingInput, { id: 'CreateBookingInput' })
register(cancelBookingByTokenInput, { id: 'CancelBookingByTokenInput' })
register(lookupBookingsInput, { id: 'LookupBookingsInput' })
register(cancelBookingByOrganizerInput, { id: 'CancelBookingByOrganizerInput' })
register(createServiceInput, { id: 'CreateServiceInput' })
register(updateServiceInput, { id: 'UpdateServiceInput' })
register(createTimeSlotInput, { id: 'CreateTimeSlotInput' })
register(updateTimeSlotInput, { id: 'UpdateTimeSlotInput' })
register(registerOrganizerInput, { id: 'RegisterOrganizerInput' })
register(updateOrganizerProfileInput, { id: 'UpdateOrganizerProfileInput' })
register(updateOrganizerLanguageInput, { id: 'UpdateOrganizerLanguageInput' })
register(createAvatarUploadInput, { id: 'CreateAvatarUploadInput' })
register(createServicePhotoUploadInput, { id: 'CreateServicePhotoUploadInput' })
register(telegramWidgetPayload, { id: 'TelegramWidgetPayload' })

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
register(guestBookingsEnvelope, { id: 'GuestBookingsEnvelope' })
register(organizerEnvelope, { id: 'OrganizerEnvelope' })
register(deletedServiceEnvelope, { id: 'DeletedServiceEnvelope' })
register(deletedSlotEnvelope, { id: 'DeletedSlotEnvelope' })
register(errorBody, { id: 'ErrorBody' })
register(validationErrors, { id: 'ValidationErrors' })
register(invalidBody, { id: 'InvalidBody' })
register(invalidIssuesBody, { id: 'InvalidIssuesBody' })
