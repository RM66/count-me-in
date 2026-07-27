import { parsePhoneNumberFromString } from 'libphonenumber-js'
import { z } from 'zod'

/** Phone as canonical E.164 (e.g. `+380501234567`). Accepts loosely formatted input and normalizes. */
export const phone = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const parsed = parsePhoneNumberFromString(value)
    if (!parsed || !parsed.isValid()) {
      ctx.addIssue({
        code: 'custom',
        message: 'Invalid phone number — use international E.164 format, e.g. +380501234567',
      })
      return z.NEVER
    }
    return parsed.number
  })

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Organizer public URL segment: lowercase letters, digits, hyphens. Normalized to lowercase. */
export const slug = z
  .string()
  .trim()
  .min(3)
  .max(40)
  .transform((value) => value.toLowerCase())
  .refine((value) => slugPattern.test(value), {
    message: 'slug must be lowercase letters, digits and single hyphens',
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
export const serviceId = z.string().regex(/^[A-Za-z0-9_-]{6,32}$/, 'Invalid service id')

export const displayName = z.string().trim().min(1).max(100)

/** Human-readable price label (display only, not a payment amount). */
export const priceText = z.string().trim().min(1).max(50)

export const organizerDescription = z.string().trim().max(4000)
export const serviceDescription = z.string().trim().max(2000)

/** Human-readable location / address label shown on public pages and passed to calendar links. */
export const location = z.string().trim().min(1).max(300)

export const seats = z.number().int().min(1).max(1000)
export const capacity = z.number().int().min(1).max(100_000)
export const durationMinutes = z.number().int().min(1).max(1440)

/** A single option label. */
export const optionLabel = z.string().trim().min(1).max(100)

/** Opaque secret from the booking management deep link. */
export const manageToken = z.string().min(10).max(200)

/** Numeric OTP code delivered via messenger. */
export const otpCode = z.string().regex(/^\d{4,8}$/, 'OTP must be 4–8 digits')

/** Opaque short-lived token proving a phone was just verified via OTP. */
export const otpTicket = z.string().min(20).max(200)
