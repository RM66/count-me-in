import { z } from 'zod'

import { DEMO_ORGANIZER_SLUG } from './demo'

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const SERVICE_ID_PATTERN = /^[A-Za-z0-9_-]{6,32}$/

/**
 * Reserved slugs that conflict with system routes (ADR-009) or with the seeded
 * demo organizer (ADR-010). `demo` passes the 4-character minimum, so without
 * reserving it a real organizer could register it and squat the public example.
 */
export const RESERVED_SLUGS = [
  'api',
  'booking',
  'cabinet',
  'signup',
  'login',
  'terms',
  'privacy',
  DEMO_ORGANIZER_SLUG,
] as const

const RESERVED_SLUG_SET = new Set<string>(RESERVED_SLUGS)

export const BOUNDS = {
  slug: { min: 4, max: 40 },
  displayName: { min: 1, max: 100 },
  priceText: { min: 1, max: 50 },
  organizerDescription: { max: 4000 },
  serviceDescription: { max: 2000 },
  location: { min: 1, max: 300 },
  contact: { min: 1, max: 300 },
  seats: { min: 1, max: 1000 },
  capacity: { min: 1, max: 100_000 },
  maxSeatsPerBooking: { min: 1, max: 1000 },
  durationMinutes: { min: 1, max: 1440 },
  optionLabel: { min: 1, max: 100 },
  manageToken: { min: 10, max: 200 },
  messengerId: { min: 1, max: 100 },
  authTicket: { min: 20, max: 200 },
} as const

/**
 * Slug as a *value*: what a stored organizer slug may look like.
 * Reserved names are not part of the shape — the demo organizer's slug is
 * itself reserved, so a response DTO validated against the registration rule
 * would reject the API's own output.
 */
export const slugShape = z
  .string()
  .trim()
  .min(BOUNDS.slug.min)
  .max(BOUNDS.slug.max)
  .transform((value) => value.toLowerCase())
  .refine((value) => SLUG_PATTERN.test(value), {
    message: 'slug must be lowercase letters, digits and single hyphens',
  })

/** Slug as a *request*: the shape plus the registration policy. */
export const slug = slugShape.refine((value) => !RESERVED_SLUG_SET.has(value), {
  message: 'this slug is reserved for system use — please choose another',
})

/** IANA timezone id (e.g. `Europe/Belgrade`). */
export const timezone = z.string().refine(
  (value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value })
      return true
    } catch {
      return false
    }
  },
  { message: 'Invalid IANA timezone' },
)

/** Internal uuid ids (organizer, time slot, booking). */
export const uuid = z.uuid()

/** Service id: short URL-friendly text id (nanoid alphabet). */
export const serviceId = z.string().regex(SERVICE_ID_PATTERN, 'Invalid service id')

/** HTTP(S) URL (avatar / cover photo). */
export const httpUrl = z.url()

export const displayName = z.string().trim().min(BOUNDS.displayName.min).max(BOUNDS.displayName.max)

/** Human-readable price label (display only, not a payment amount). */
export const priceText = z.string().trim().min(BOUNDS.priceText.min).max(BOUNDS.priceText.max)

export const organizerDescription = z.string().trim().max(BOUNDS.organizerDescription.max)
export const serviceDescription = z.string().trim().max(BOUNDS.serviceDescription.max)

/** Human-readable location / address label shown on public pages and passed to calendar links. */
export const location = z.string().trim().min(BOUNDS.location.min).max(BOUNDS.location.max)

/** Optional display-only contact string (phone, email, URL or plain text). Detected at render time. */
export const contact = z.string().trim().min(BOUNDS.contact.min).max(BOUNDS.contact.max)

export const seats = z.number().int().min(BOUNDS.seats.min).max(BOUNDS.seats.max)
export const capacity = z.number().int().min(BOUNDS.capacity.min).max(BOUNDS.capacity.max)

/**
 * Cap on seats a single guest may claim in one booking (party size).
 * `1` means solo-only; higher values let a guest bring others without one
 * person swallowing a whole slot. Bounded by `seats`, the per-booking max.
 */
export const maxSeatsPerBooking = z
  .number()
  .int()
  .min(BOUNDS.maxSeatsPerBooking.min)
  .max(BOUNDS.maxSeatsPerBooking.max)
export const durationMinutes = z
  .number()
  .int()
  .min(BOUNDS.durationMinutes.min)
  .max(BOUNDS.durationMinutes.max)

/** A single option label. */
export const optionLabel = z.string().trim().min(BOUNDS.optionLabel.min).max(BOUNDS.optionLabel.max)

/** Opaque secret from the booking management deep link. */
export const manageToken = z.string().min(BOUNDS.manageToken.min).max(BOUNDS.manageToken.max)

/** Messenger user id (e.g. Telegram user id as a string). */
export const messengerId = z.string().min(BOUNDS.messengerId.min).max(BOUNDS.messengerId.max)

/**
 * Opaque short-lived token proving messenger identity was validated (ADR-008).
 * Replaces the old `otpTicket` — same shape, new semantics (widget HMAC, not OTP code).
 */
export const authTicket = z.string().min(BOUNDS.authTicket.min).max(BOUNDS.authTicket.max)
