import { requestOtpInput } from '@repo/api-contracts'
import { NextResponse } from 'next/server'

import { createOtp } from '@/lib/services/otp'
import { getOtpSender } from '@/lib/services/otp/sender'

/**
 * Send an OTP to the phone's messenger (signup, login and guest flows share this).
 * Always responds 200 on success without revealing whether the phone is registered.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const parsed = requestOtpInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 })
  }

  const { phone, messenger = 'telegram' } = parsed.data

  const result = await createOtp(phone, messenger)
  if (!result.ok) {
    const message =
      result.reason === 'cooldown'
        ? 'Code already sent — wait a minute before requesting again'
        : 'Too many codes requested — try again later'
    return NextResponse.json({ error: message }, { status: 429 })
  }

  await getOtpSender().send(phone, messenger, result.code)

  return NextResponse.json({ ok: true })
}
