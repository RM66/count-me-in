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
import { bookingCancelledJob, bookingCreatedJob, cancelActorEnum, notificationRecipientEnum } from './jobs'
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

export type WireKind = 'primitive' | 'enum' | 'input' | 'update' | 'record'

export type WireMeta = {
  id: string
  kind: WireKind
  'x-go-type'?: string
  'x-go-rule'?: string
  'x-go-refine'?: string
  'x-go-trim'?: true
  'x-go-enum-consts'?: Record<string, string>
}

export const wire = z.registry<WireMeta>()

export const WIRE_SCHEMAS: Record<string, z.ZodType> = {}
/** Metadata keyed by registry id. Do not use `wire.get(schema)` to recover
 *  this: Zod walks a refined schema's parent, so `get(slug)` returns
 *  `slugShape`'s meta (without `id`). */
export const WIRE_META: Record<string, WireMeta> = {}

export function register(schema: z.ZodType, meta: WireMeta): void {
  if (WIRE_SCHEMAS[meta.id] !== undefined) {
    throw new Error(`wire: duplicate id "${meta.id}"`)
  }
  // Aliased exports (imageUploadTarget === avatarUploadTarget) are one object;
  // a second id for it would make identity lookup return the wrong meta.
  for (const [existingId, existingSchema] of Object.entries(WIRE_SCHEMAS)) {
    if (existingSchema === schema) {
      throw new Error(`wire: schema already registered as "${existingId}" — cannot also register it as "${meta.id}"`)
    }
  }
  wire.add(schema, meta)
  WIRE_SCHEMAS[meta.id] = schema
  WIRE_META[meta.id] = meta
}

/** Meta for a registered schema by object identity, not Zod parent-walk. */
export function metaOfSchema(schema: z.ZodType): WireMeta | undefined {
  const id = Object.entries(WIRE_SCHEMAS).find(([, s]) => s === schema)?.[0]
  return id === undefined ? undefined : WIRE_META[id]
}

// A.1 Primitives — порядок = порядок выводимых правил в validation_gen.go.
register(displayName, { id: 'DisplayName', kind: 'primitive', 'x-go-trim': true })
register(priceText, { id: 'PriceText', kind: 'primitive', 'x-go-trim': true })
register(organizerDescription, { id: 'OrganizerDescription', kind: 'primitive', 'x-go-trim': true })
register(serviceDescription, { id: 'ServiceDescription', kind: 'primitive', 'x-go-trim': true })
register(location, { id: 'Location', kind: 'primitive', 'x-go-trim': true })
register(contact, { id: 'Contact', kind: 'primitive', 'x-go-trim': true })
register(optionLabel, { id: 'OptionLabel', kind: 'primitive', 'x-go-trim': true })
register(manageToken, { id: 'ManageToken', kind: 'primitive' })
register(messengerId, { id: 'MessengerID', kind: 'primitive' })
register(authTicket, { id: 'AuthTicket', kind: 'primitive' })
register(seats, { id: 'Seats', kind: 'primitive' })
register(capacity, { id: 'Capacity', kind: 'primitive' })
register(durationMinutes, { id: 'DurationMinutes', kind: 'primitive' })
register(maxSeatsPerBooking, { id: 'MaxSeatsPerBooking', kind: 'primitive' })
register(avatarUploadSize, { id: 'AvatarUploadSize', kind: 'primitive' })
register(servicePhotoUploadSize, { id: 'ServicePhotoUploadSize', kind: 'primitive' })
register(uuid, { id: 'UUID', kind: 'primitive', 'x-go-rule': 'UUIDRule' })
register(serviceId, { id: 'ServiceID', kind: 'primitive', 'x-go-rule': 'ServiceIDRule' })
register(slugShape, { id: 'SlugShape', kind: 'primitive', 'x-go-trim': true, 'x-go-rule': 'SlugShapeRule' })
register(slug, { id: 'Slug', kind: 'primitive', 'x-go-trim': true, 'x-go-rule': 'SlugRule' })
register(timezone, { id: 'Timezone', kind: 'primitive', 'x-go-rule': 'TimezoneRule' })
register(httpUrl, { id: 'URL', kind: 'primitive', 'x-go-rule': 'URLRule' })
register(slotStartsAt, { id: 'SlotStartsAt', kind: 'primitive', 'x-go-type': 'FlexTime' })
register(optionsList, { id: 'OptionsList', kind: 'primitive' })
register(selectedOptionsShape, { id: 'SelectedOptions', kind: 'primitive' })
register(telegramUserId, { id: 'TelegramUserID', kind: 'primitive' })
register(telegramAuthDate, { id: 'TelegramAuthDate', kind: 'primitive' })
register(telegramName, { id: 'TelegramName', kind: 'primitive' })
register(telegramOptionalName, { id: 'TelegramOptionalName', kind: 'primitive' })
register(telegramHash, { id: 'TelegramHash', kind: 'primitive' })

// A.2 Enums — порядок = порядок enum-блоков в contracts_gen.go.
// x-go-enum-consts покрывают все .options (требует тест полноты);
// именованные константы Go выводятся из них.
register(bookingStatusEnum, {
  id: 'BookingStatus',
  kind: 'enum',
  'x-go-enum-consts': { confirmed: 'BookingConfirmed', cancelled: 'BookingCancelled' },
})
register(messengerEnum, {
  id: 'Messenger',
  kind: 'enum',
  'x-go-enum-consts': { telegram: 'MessengerTelegram' },
})
register(optionsSelectModeEnum, {
  id: 'OptionsSelectMode',
  kind: 'enum',
  'x-go-enum-consts': { single: 'OptionsSingle', multi: 'OptionsMulti' },
})
register(notificationRecipientEnum, {
  id: 'NotificationRecipient',
  kind: 'enum',
  'x-go-enum-consts': { organizer: 'RecipientOrganizer', guest: 'RecipientGuest' },
})
register(cancelActorEnum, {
  id: 'CancelActor',
  kind: 'enum',
  'x-go-enum-consts': { guest: 'ActorGuest', organizer: 'ActorOrganizer' },
})
register(appLocaleEnum, { id: 'AppLocale', kind: 'enum', 'x-go-type': 'string' })
register(avatarContentType, { id: 'ImageContentType', kind: 'enum', 'x-go-type': 'string' })

// A.3 Inputs / updates — порядок = порядок эмиссии структур и парсеров.
register(createBookingInput, { id: 'CreateBookingInput', kind: 'input' })
register(cancelBookingByTokenInput, { id: 'CancelBookingByTokenInput', kind: 'input' })
register(lookupBookingsInput, { id: 'LookupBookingsInput', kind: 'input' })
register(cancelBookingByOrganizerInput, { id: 'CancelBookingByOrganizerInput', kind: 'input' })
register(createServiceInput, { id: 'CreateServiceInput', kind: 'input', 'x-go-refine': 'refineCreateServiceInput' })
register(updateServiceInput, { id: 'UpdateServiceInput', kind: 'update', 'x-go-refine': 'refineUpdateServiceInput' })
register(createTimeSlotInput, { id: 'CreateTimeSlotInput', kind: 'input', 'x-go-refine': 'refineCreateTimeSlotInput' })
register(updateTimeSlotInput, { id: 'UpdateTimeSlotInput', kind: 'update', 'x-go-refine': 'refineUpdateTimeSlotInput' })
register(registerOrganizerInput, { id: 'RegisterOrganizerInput', kind: 'input', 'x-go-refine': 'refineRegisterOrganizerInput' })
register(updateOrganizerProfileInput, { id: 'UpdateOrganizerProfileInput', kind: 'update', 'x-go-refine': 'refineUpdateOrganizerProfileInput' })
register(updateOrganizerLanguageInput, { id: 'UpdateOrganizerLanguageInput', kind: 'input' })
register(createAvatarUploadInput, { id: 'CreateAvatarUploadInput', kind: 'input' })
register(createServicePhotoUploadInput, { id: 'CreateServicePhotoUploadInput', kind: 'input' })
register(telegramWidgetPayload, { id: 'TelegramWidgetPayload', kind: 'input' })

// A.4 Records.
// imageUploadTarget и avatarUploadTarget — один объект; servicePhotoContentType —
// тот же объект, что avatarContentType: wire.get() находит их по identity.
register(organizerProfile, { id: 'OrganizerProfile', kind: 'record' })
register(publicOrganizer, { id: 'PublicOrganizer', kind: 'record' })
register(serviceRecord, { id: 'ServiceRecord', kind: 'record' })
register(timeSlotRecord, { id: 'TimeSlotRecord', kind: 'record' })
register(bookingRecord, { id: 'BookingRecord', kind: 'record' })
register(guestBooking, { id: 'GuestBooking', kind: 'record' })
register(imageUploadTarget, { id: 'ImageUploadTarget', kind: 'record' })
register(registeredOrganizer, { id: 'RegisteredOrganizer', kind: 'record' })
register(registered, { id: 'Registered', kind: 'record' })
register(authTicketPayload, { id: 'AuthTicketPayload', kind: 'record' })
register(guestTicketResponse, { id: 'GuestTicketResponse', kind: 'record' })
register(authTicketResponse, { id: 'AuthTicketResponse', kind: 'record' })
register(loginLinkPayload, { id: 'LoginLinkPayload', kind: 'record' })
register(bookingCreatedJob, { id: 'BookingCreatedJob', kind: 'record' })
register(bookingCancelledJob, { id: 'BookingCancelledJob', kind: 'record' })

// Конверты ответов (этап 5, Приложение G) — в конец записей.
register(serviceEnvelope, { id: 'ServiceEnvelope', kind: 'record' })
register(servicesEnvelope, { id: 'ServicesEnvelope', kind: 'record' })
register(slotEnvelope, { id: 'SlotEnvelope', kind: 'record' })
register(slotsEnvelope, { id: 'SlotsEnvelope', kind: 'record' })
register(guestBookingEnvelope, { id: 'GuestBookingEnvelope', kind: 'record' })
register(bookingEnvelope, { id: 'BookingEnvelope', kind: 'record' })
register(guestBookingsEnvelope, { id: 'GuestBookingsEnvelope', kind: 'record' })
register(organizerEnvelope, { id: 'OrganizerEnvelope', kind: 'record' })
register(deletedServiceEnvelope, { id: 'DeletedServiceEnvelope', kind: 'record' })
register(deletedSlotEnvelope, { id: 'DeletedSlotEnvelope', kind: 'record' })
register(errorBody, { id: 'ErrorBody', kind: 'record' })
register(validationErrors, { id: 'ValidationErrors', kind: 'record' })
register(invalidBody, { id: 'InvalidBody', kind: 'record' })
register(invalidIssuesBody, { id: 'InvalidIssuesBody', kind: 'record' })
