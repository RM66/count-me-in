import { z } from 'zod'

import { messengerEnum } from './enums'
import { otpCode, otpTicket, phone } from './primitives'

/** Ask for an OTP to be delivered to the phone's messenger. */
export const requestOtpInput = z.object({ phone, messenger: messengerEnum.optional() })
export type RequestOtpInput = z.infer<typeof requestOtpInput>

/** Verify a delivered OTP. */
export const verifyOtpInput = z.object({ phone, code: otpCode })
export type VerifyOtpInput = z.infer<typeof verifyOtpInput>

/**
 * Successful verification yields a short-lived, single-purpose ticket proving
 * phone ownership. It is exchanged for a session (login) or attached to
 * organizer registration (signup).
 */
export const verifyOtpResponse = z.object({
  ticket: otpTicket,
  /** Whether an organizer already exists for this phone (drives login vs signup UX). */
  organizerExists: z.boolean(),
})
export type VerifyOtpResponse = z.infer<typeof verifyOtpResponse>

/** Enter the booking management page by phone (then verify via OTP). */
export const bookingLookupByPhoneInput = z.object({ phone })
export type BookingLookupByPhoneInput = z.infer<typeof bookingLookupByPhoneInput>
