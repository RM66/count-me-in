import { z } from 'zod'
import { otpCode, phone } from './primitives.js'

/** Ask for an OTP to be delivered to the phone's messenger. */
export const requestOtpInput = z.object({ phone })
export type RequestOtpInput = z.infer<typeof requestOtpInput>

/** Verify a delivered OTP. */
export const verifyOtpInput = z.object({ phone, code: otpCode })
export type VerifyOtpInput = z.infer<typeof verifyOtpInput>

/** Enter the booking management page by phone (then verify via OTP). */
export const bookingLookupByPhoneInput = z.object({ phone })
export type BookingLookupByPhoneInput = z.infer<typeof bookingLookupByPhoneInput>
