/**
 * The HTTP surface of the API, as data.
 *
 * Schemas describe payloads; this describes where they travel. Both the
 * OpenAPI spec and the Python route table are derived from it, and a test
 * asserts the app dispatches exactly these method/path pairs — so an endpoint
 * cannot exist without being described, and a described endpoint cannot be
 * missing.
 *
 * Responses reference Zod schemas by identity rather than by name so a typo is
 * a type error; the generator resolves the wire id through the registry.
 *
 * Not re-exported from `index.ts` — that would pull the table into the client
 * bundle. Import via `@repo/contracts/routes`.
 */
import type { z } from 'zod'

import { authTicketResponse, guestTicketResponse, telegramWidgetPayload } from './auth'
import {
  cancelBookingByOrganizerInput,
  cancelBookingByTokenInput,
  createBookingInput,
  lookupBookingByTokenInput,
  lookupBookingsInput,
} from './booking'
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
  serviceEnvelope,
  servicesEnvelope,
  slotEnvelope,
  slotsEnvelope,
} from './envelopes'
import { errorBody, invalidBody } from './errors'
import {
  QUEUE_BOOKING_CANCELLED,
  QUEUE_BOOKING_CREATED,
  QUEUE_DEMO_REFRESH,
  QUEUE_OUTBOX_SWEEP,
} from './jobs'
import {
  internalOrganizerLookupInput,
  registerOrganizerInput,
  registrationResponse,
  updateOrganizerLanguageInput,
  updateOrganizerProfileInput,
} from './organizer'
import { queryLimit, queryOffset, serviceId, slugShape, uuid } from './primitives'
import { createServiceInput, updateServiceInput } from './service'
import {
  createAvatarUploadInput,
  createServicePhotoUploadInput,
  imageUploadTarget,
} from './storage'
import { createTimeSlotInput, updateTimeSlotInput } from './time-slot'

/**
 * How a request proves it may do what it asks.
 * - `public` — no credential at all.
 * - `guestTicket` — a single-use auth ticket carried in the request body and
 *   consumed server-side (`require_guest_identity` in the API).
 * - `manageToken` — the guest's per-booking secret, in the body.
 * - `sessionWritable` — an Auth.js session that is neither absent nor the demo
 *   organizer (`require_writable_organizer` in the API); refusal is 403, never 401.
 * - `sessionOrDemoRead` — an Auth.js session if present, otherwise the demo
 *   organizer (ADR-010). Never 401.
 * - `qstashSignature` — the `upstash-signature` header.
 */
export type ApiAuth =
  | 'public'
  | 'guestTicket'
  | 'manageToken'
  | 'sessionWritable'
  | 'sessionOrDemoRead'
  | 'qstashSignature'
  | 'internal'

export type ApiParam = {
  name: string
  in: 'path' | 'query'
  required: boolean
  /** A registered primitive, or a literal enumeration for ad-hoc params. */
  schema: z.ZodType | { enum: readonly string[] }
  description?: string
}

export type ApiResponse = {
  status: number
  description: string
  /** Absent means the response carries no body. */
  body?: z.ZodType
  /** Several payload shapes behind one status (the jobs receiver). */
  bodyAnyOf?: readonly z.ZodType[]
}

export type ApiRoute = {
  operationId: string
  method: 'get' | 'post' | 'put' | 'patch' | 'delete'
  /** OpenAPI path spelling, `{param}` for path parameters. */
  path: string
  summary: string
  auth: ApiAuth
  params?: readonly ApiParam[]
  request?: z.ZodType
  /**
   * Media type of the request body. The three partial-update endpoints use
   * JSON Merge Patch (RFC 7386, ADR-016): absent key = keep, explicit null =
   * clear — the semantics come from the media type itself.
   *
   * A cross-field pair (service `options` + `optionsSelectMode`) must be
   * patched together in both directions: the consistency refine reads the
   * patch, not the merged row, so clearing options means sending both keys
   * as null and setting them means sending both values.
   */
  requestContentType?: 'application/json' | 'application/merge-patch+json'
  responses: readonly ApiResponse[]
  /** Documented for the spec and for the 429 response; enforcement is in the handler. */
  rateLimit?: { limit: number; windowSeconds: number; per: 'ip' | 'organizer' }
}

const UNSUPPORTED_MEDIA_TYPE = {
  status: 415,
  description: 'Content-Type must be application/merge-patch+json (RFC 7386)',
  body: errorBody,
} as const
const TOO_MANY = { status: 429, description: 'Rate limit exceeded', body: errorBody } as const
const INVALID_BODY = { status: 400, description: 'Validation error', body: invalidBody } as const
/** 400s that are not all body-shape failures: the validation envelope
 * (invalidBody, details) shares the status with plain coded refusals —
 * nothing to update, media-prefix or empty-criteria violations. */
const BAD_REQUEST = {
  status: 400,
  description: 'Validation error or a plain coded refusal',
  bodyAnyOf: [invalidBody, errorBody],
} as const
const MALFORMED_ID = {
  status: 400,
  description: 'Malformed path parameter',
  body: errorBody,
} as const
const INTERNAL = { status: 500, description: 'Internal error' } as const
const DEMO_FORBIDDEN = {
  status: 403,
  description: 'Demo account is read-only, or the caller has no session (ADR-010)',
  body: errorBody,
} as const

export const API_ROUTES: readonly ApiRoute[] = [
  // ── Auth (Telegram widget) ────────────────────────────────────────────────
  {
    operationId: 'telegramGuest',
    method: 'post',
    path: '/api/auth/telegram-guest',
    summary: 'Verify Telegram login widget data and mint a single-use guest ticket',
    auth: 'public',
    request: telegramWidgetPayload,
    rateLimit: { limit: 10, windowSeconds: 60, per: 'ip' },
    responses: [
      { status: 200, description: 'Guest ticket issued', body: guestTicketResponse },
      { status: 400, description: 'Malformed widget payload or failed HMAC', body: errorBody },
      TOO_MANY,
      { status: 500, description: 'Telegram bot is not configured', body: errorBody },
    ],
  },
  {
    operationId: 'telegramSignup',
    method: 'post',
    path: '/api/auth/telegram-signup',
    summary: 'Verify Telegram login widget data and mint an organizer signup ticket',
    auth: 'public',
    request: telegramWidgetPayload,
    rateLimit: { limit: 5, windowSeconds: 60, per: 'ip' },
    responses: [
      { status: 200, description: 'Auth ticket issued', body: authTicketResponse },
      { status: 400, description: 'Malformed widget payload or failed HMAC', body: errorBody },
      TOO_MANY,
      { status: 500, description: 'Telegram bot is not configured', body: errorBody },
    ],
  },

  // ── Organizers ────────────────────────────────────────────────────────────
  {
    operationId: 'registerOrganizer',
    method: 'post',
    path: '/api/organizers',
    summary: 'Register a new organizer using an auth ticket',
    auth: 'public',
    request: registerOrganizerInput,
    rateLimit: { limit: 10, windowSeconds: 3600, per: 'ip' },
    responses: [
      { status: 201, description: 'Organizer created', body: registrationResponse },
      INVALID_BODY,
      { status: 401, description: 'Auth ticket expired or unknown', body: errorBody },
      {
        status: 409,
        description: 'Slug taken, or an account already exists for this identity',
        body: errorBody,
      },
      TOO_MANY,
      INTERNAL,
    ],
  },
  {
    operationId: 'getMyProfile',
    method: 'get',
    path: '/api/organizers/me',
    summary: 'Get the organizer this request may view (demo when anonymous)',
    auth: 'sessionOrDemoRead',
    responses: [
      { status: 200, description: 'Organizer profile', body: organizerEnvelope },
      {
        status: 404,
        description: 'Organizer not found, or the demo seed has not run',
        body: errorBody,
      },
      INTERNAL,
    ],
  },
  {
    operationId: 'updateMyProfile',
    method: 'patch',
    path: '/api/organizers/me',
    summary: 'Update organizer profile',
    auth: 'sessionWritable',
    request: updateOrganizerProfileInput,
    requestContentType: 'application/merge-patch+json',
    responses: [
      { status: 200, description: 'Updated profile', body: organizerEnvelope },
      UNSUPPORTED_MEDIA_TYPE,
      BAD_REQUEST,
      DEMO_FORBIDDEN,
      { status: 404, description: 'Organizer not found', body: errorBody },
      INTERNAL,
    ],
  },
  {
    operationId: 'updateMyLanguage',
    method: 'patch',
    path: '/api/organizers/me/language',
    summary: 'Update organizer notification language',
    auth: 'sessionWritable',
    request: updateOrganizerLanguageInput,
    responses: [
      { status: 204, description: 'Language updated' },
      INVALID_BODY,
      DEMO_FORBIDDEN,
      INTERNAL,
    ],
  },
  {
    operationId: 'createAvatarUploadTarget',
    method: 'post',
    path: '/api/organizers/me/avatar',
    summary: 'Mint a signed upload URL for an avatar image',
    auth: 'sessionWritable',
    request: createAvatarUploadInput,
    rateLimit: { limit: 10, windowSeconds: 3600, per: 'organizer' },
    responses: [
      { status: 200, description: 'Signed upload target', body: imageUploadTarget },
      INVALID_BODY,
      DEMO_FORBIDDEN,
      TOO_MANY,
      INTERNAL,
    ],
  },
  {
    operationId: 'createServicePhotoUploadTarget',
    method: 'post',
    path: '/api/organizers/me/service-photo',
    summary: 'Mint a signed upload URL for a service cover photo',
    auth: 'sessionWritable',
    request: createServicePhotoUploadInput,
    rateLimit: { limit: 10, windowSeconds: 3600, per: 'organizer' },
    responses: [
      { status: 200, description: 'Signed upload target', body: imageUploadTarget },
      INVALID_BODY,
      DEMO_FORBIDDEN,
      TOO_MANY,
      INTERNAL,
    ],
  },
  {
    operationId: 'getCabinetSummary',
    method: 'get',
    path: '/api/cabinet/summary',
    summary: 'Get cabinet summary counts and 30-day analytics for the organizer',
    auth: 'sessionOrDemoRead',
    responses: [
      { status: 200, description: 'Cabinet summary and analytics', body: cabinetSummaryEnvelope },
      INTERNAL,
    ],
  },

  // ── Public ────────────────────────────────────────────────────────────────
  {
    operationId: 'getPublicOrganizer',
    method: 'get',
    path: '/api/public/organizers/{slug}',
    summary: 'Get public organizer profile, services, and upcoming slots by slug',
    auth: 'public',
    params: [{ name: 'slug', in: 'path', required: true, schema: slugShape }],
    rateLimit: { limit: 60, windowSeconds: 60, per: 'ip' },
    responses: [
      { status: 200, description: 'Public organizer view', body: publicOrganizerViewEnvelope },
      { status: 404, description: 'Organizer not found', body: errorBody },
      TOO_MANY,
      INTERNAL,
    ],
  },
  {
    operationId: 'getPublicService',
    method: 'get',
    path: '/api/public/services/{id}',
    summary: 'Get public service details, parent organizer, and upcoming slots',
    auth: 'public',
    params: [{ name: 'id', in: 'path', required: true, schema: serviceId }],
    rateLimit: { limit: 60, windowSeconds: 60, per: 'ip' },
    responses: [
      { status: 200, description: 'Public service view', body: publicServiceViewEnvelope },
      { status: 404, description: 'Service not found', body: errorBody },
      TOO_MANY,
      INTERNAL,
    ],
  },
  {
    operationId: 'getPublicSitemap',
    method: 'get',
    path: '/api/public/sitemap',
    summary: 'List all public organizer slugs and service paths for sitemap generation',
    auth: 'public',
    rateLimit: { limit: 10, windowSeconds: 60, per: 'ip' },
    responses: [
      { status: 200, description: 'Public sitemap catalog', body: publicSitemapEnvelope },
      TOO_MANY,
      INTERNAL,
    ],
  },

  // ── Services ──────────────────────────────────────────────────────────────
  {
    operationId: 'listServices',
    method: 'get',
    path: '/api/services',
    summary: 'List the services of the organizer this request may view',
    auth: 'sessionOrDemoRead',
    responses: [{ status: 200, description: 'Services', body: servicesEnvelope }, INTERNAL],
  },
  {
    operationId: 'createService',
    method: 'post',
    path: '/api/services',
    summary: 'Create a service',
    auth: 'sessionWritable',
    request: createServiceInput,
    responses: [
      { status: 201, description: 'Service created', body: serviceEnvelope },
      {
        status: 400,
        description:
          'Body-shape failures answer invalidBody; photoUrl outside the organizer media prefix answers errorBody',
        bodyAnyOf: [invalidBody, errorBody],
      },
      DEMO_FORBIDDEN,
      INTERNAL,
    ],
  },
  {
    operationId: 'getService',
    method: 'get',
    path: '/api/services/{id}',
    summary: 'Get one service owned by the organizer this request may view',
    auth: 'sessionOrDemoRead',
    params: [{ name: 'id', in: 'path', required: true, schema: serviceId }],
    responses: [
      { status: 200, description: 'Service', body: serviceEnvelope },
      { status: 404, description: 'Service not found', body: errorBody },
      INTERNAL,
    ],
  },
  {
    operationId: 'updateService',
    method: 'patch',
    path: '/api/services/{id}',
    summary: 'Update a service',
    auth: 'sessionWritable',
    params: [{ name: 'id', in: 'path', required: true, schema: serviceId }],
    request: updateServiceInput,
    requestContentType: 'application/merge-patch+json',
    responses: [
      { status: 200, description: 'Service updated', body: serviceEnvelope },
      UNSUPPORTED_MEDIA_TYPE,
      {
        status: 400,
        description:
          'Validation error answers invalidBody; nothing to update or a photoUrl outside the organizer media prefix answers errorBody',
        bodyAnyOf: [invalidBody, errorBody],
      },
      DEMO_FORBIDDEN,
      { status: 404, description: 'Service not found', body: errorBody },
      INTERNAL,
    ],
  },
  {
    operationId: 'deleteService',
    method: 'delete',
    path: '/api/services/{id}',
    summary: 'Delete a service; refuses when booking rows reference its slots',
    auth: 'sessionWritable',
    params: [{ name: 'id', in: 'path', required: true, schema: serviceId }],
    responses: [
      { status: 200, description: 'Service deleted', body: deletedServiceEnvelope },
      DEMO_FORBIDDEN,
      { status: 404, description: 'Service not found', body: errorBody },
      {
        status: 409,
        description: 'Service still has bookings referencing its slots',
        body: errorBody,
      },
      INTERNAL,
    ],
  },

  // ── Slots ─────────────────────────────────────────────────────────────────
  {
    operationId: 'listSlots',
    method: 'get',
    path: '/api/slots',
    summary: 'List slots across every service of the organizer this request may view',
    auth: 'sessionOrDemoRead',
    params: [
      {
        name: 'upcoming',
        in: 'query',
        required: false,
        schema: { enum: ['1'] },
        description: 'When "1", slots that have already started are omitted.',
      },
    ],
    responses: [
      { status: 200, description: 'Slots', body: slotsEnvelope },
      { status: 400, description: 'Invalid query parameters', body: errorBody },
      INTERNAL,
    ],
  },
  {
    operationId: 'createSlot',
    method: 'post',
    path: '/api/slots',
    summary: "Create a time slot under one of the organizer's services",
    auth: 'sessionWritable',
    request: createTimeSlotInput,
    responses: [
      { status: 201, description: 'Slot created', body: slotEnvelope },
      INVALID_BODY,
      DEMO_FORBIDDEN,
      { status: 404, description: 'Service not found or not owned by the caller', body: errorBody },
      INTERNAL,
    ],
  },
  {
    operationId: 'getSlot',
    method: 'get',
    path: '/api/slots/{id}',
    summary: 'Get one slot owned by the organizer this request may view',
    auth: 'sessionOrDemoRead',
    params: [{ name: 'id', in: 'path', required: true, schema: uuid }],
    responses: [
      { status: 200, description: 'Slot', body: slotEnvelope },
      MALFORMED_ID,
      { status: 404, description: 'Slot not found', body: errorBody },
      INTERNAL,
    ],
  },
  {
    operationId: 'updateSlot',
    method: 'patch',
    path: '/api/slots/{id}',
    summary: 'Update a time slot; bookedCount is never writable',
    auth: 'sessionWritable',
    params: [{ name: 'id', in: 'path', required: true, schema: uuid }],
    request: updateTimeSlotInput,
    requestContentType: 'application/merge-patch+json',
    responses: [
      { status: 200, description: 'Slot updated', body: slotEnvelope },
      UNSUPPORTED_MEDIA_TYPE,
      {
        status: 400,
        description:
          'Validation error answers invalidBody; a malformed path id or nothing to update answers errorBody',
        bodyAnyOf: [invalidBody, errorBody],
      },
      DEMO_FORBIDDEN,
      { status: 404, description: 'Slot not found', body: errorBody },
      { status: 409, description: 'Capacity below the seats already booked', body: errorBody },
      INTERNAL,
    ],
  },
  {
    operationId: 'deleteSlot',
    method: 'delete',
    path: '/api/slots/{id}',
    summary: 'Delete a time slot',
    auth: 'sessionWritable',
    params: [{ name: 'id', in: 'path', required: true, schema: uuid }],
    responses: [
      { status: 200, description: 'Slot deleted', body: deletedSlotEnvelope },
      MALFORMED_ID,
      DEMO_FORBIDDEN,
      { status: 404, description: 'Slot not found', body: errorBody },
      { status: 409, description: 'Slot still has confirmed bookings', body: errorBody },
      INTERNAL,
    ],
  },

  // ── Bookings ──────────────────────────────────────────────────────────────
  {
    operationId: 'listBookings',
    method: 'get',
    path: '/api/bookings',
    summary: 'List bookings of the organizer this request may view',
    auth: 'sessionOrDemoRead',
    params: [
      {
        name: 'limit',
        in: 'query',
        required: false,
        schema: queryLimit,
        description: 'Maximum bookings to return (default 50, max 100).',
      },
      {
        name: 'offset',
        in: 'query',
        required: false,
        schema: queryOffset,
        description: 'Number of bookings to skip (default 0).',
      },
    ],
    responses: [
      { status: 200, description: 'Bookings', body: bookingsEnvelope },
      { status: 400, description: 'Invalid query parameters', body: errorBody },
      INTERNAL,
    ],
  },
  {
    operationId: 'createBooking',
    method: 'post',
    path: '/api/bookings',
    summary: 'Guest creates a booking (atomic reserve)',
    auth: 'guestTicket',
    request: createBookingInput,
    rateLimit: { limit: 5, windowSeconds: 60, per: 'ip' },
    responses: [
      { status: 201, description: 'Booking confirmed', body: guestBookingEnvelope },
      {
        status: 400,
        description:
          'Body-shape failures answer invalidBody; domain refusals (invalid option selection, party over the per-booking cap) answer errorBody with a code',
        bodyAnyOf: [invalidBody, errorBody],
      },
      { status: 401, description: 'Guest ticket expired or already used', body: errorBody },
      DEMO_FORBIDDEN,
      { status: 404, description: 'Slot or service no longer bookable', body: errorBody },
      {
        status: 409,
        description:
          'Sold out, capacity exceeded, or duplicate booking (one active booking per guest per slot)',
        body: errorBody,
      },
      TOO_MANY,
      INTERNAL,
    ],
  },
  {
    operationId: 'lookupBookings',
    method: 'post',
    path: '/api/bookings/lookup',
    summary: "Look up a guest's bookings with a single-use ticket",
    auth: 'guestTicket',
    request: lookupBookingsInput,
    rateLimit: { limit: 10, windowSeconds: 60, per: 'ip' },
    responses: [
      { status: 200, description: 'Guest bookings', body: guestBookingsEnvelope },
      INVALID_BODY,
      { status: 401, description: 'Guest ticket expired or already used', body: errorBody },
      TOO_MANY,
      INTERNAL,
    ],
  },
  {
    operationId: 'cancelBookingByToken',
    method: 'post',
    path: '/api/bookings/cancel',
    summary: 'Guest cancels a booking via manageToken',
    auth: 'manageToken',
    request: cancelBookingByTokenInput,
    rateLimit: { limit: 10, windowSeconds: 60, per: 'ip' },
    responses: [
      { status: 200, description: 'Booking cancelled', body: guestBookingEnvelope },
      INVALID_BODY,
      DEMO_FORBIDDEN,
      {
        status: 404,
        description: 'Booking not found (also the answer for an unknown token)',
        body: errorBody,
      },
      { status: 409, description: 'Booking already cancelled', body: errorBody },
      TOO_MANY,
      INTERNAL,
    ],
  },
  {
    operationId: 'getBookingByManageToken',
    method: 'post',
    path: '/api/bookings/manage-lookup',
    summary: 'Guest looks up a booking via manageToken',
    auth: 'manageToken',
    request: lookupBookingByTokenInput,
    rateLimit: { limit: 10, windowSeconds: 60, per: 'ip' },
    responses: [
      { status: 200, description: 'Guest booking details', body: guestBookingEnvelope },
      INVALID_BODY,
      {
        status: 404,
        description: 'Booking not found or token expired',
        body: errorBody,
      },
      TOO_MANY,
      INTERNAL,
    ],
  },
  {
    operationId: 'cancelBookingByOrganizer',
    method: 'post',
    path: '/api/bookings/cancel-by-organizer',
    summary: 'Organizer cancels a booking on one of their own services',
    auth: 'sessionWritable',
    request: cancelBookingByOrganizerInput,
    responses: [
      { status: 200, description: 'Booking cancelled', body: bookingEnvelope },
      INVALID_BODY,
      DEMO_FORBIDDEN,
      {
        status: 404,
        description: 'Booking not found or not on a service owned by the caller',
        body: errorBody,
      },
      { status: 409, description: 'Booking already cancelled', body: errorBody },
      INTERNAL,
    ],
  },

  // ── Jobs ──────────────────────────────────────────────────────────────────
  {
    operationId: 'runJob',
    method: 'post',
    path: '/api/jobs/{queue}',
    summary: 'Upstash QStash webhook consumer',
    auth: 'qstashSignature',
    params: [
      {
        name: 'queue',
        in: 'path',
        required: true,
        schema: {
          enum: [
            QUEUE_BOOKING_CREATED,
            QUEUE_BOOKING_CANCELLED,
            QUEUE_DEMO_REFRESH,
            QUEUE_OUTBOX_SWEEP,
          ],
        },
      },
    ],
    responses: [
      { status: 200, description: 'Job succeeded (including an unreachable recipient — no retry)' },
      { status: 400, description: 'Malformed payload — retrying would resend the same bytes' },
      { status: 401, description: 'Missing or invalid upstash-signature' },
      { status: 404, description: 'Unknown queue name' },
      { status: 500, description: 'Handler failure (triggers a QStash retry)' },
    ],
  },

  // ── Internal ──────────────────────────────────────────────────────────────
  {
    operationId: 'getOrganizerByMessenger',
    method: 'post',
    path: '/api/internal/auth/organizer-by-messenger',
    summary: 'Internal lookup of organizer by messenger identity or organizer ID for Auth.js',
    auth: 'internal',
    request: internalOrganizerLookupInput,
    responses: [
      { status: 200, description: 'Organizer found', body: internalOrganizerEnvelope },
      BAD_REQUEST,
      { status: 401, description: 'Invalid or missing internal secret', body: errorBody },
      { status: 404, description: 'Organizer not found', body: errorBody },
      INTERNAL,
    ],
  },
]
