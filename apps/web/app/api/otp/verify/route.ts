import { verifyOtpInput, type VerifyOtpResponse } from '@repo/api-contracts'
import { db, organizers } from '@repo/db'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'

import { verifyOtp } from '@/lib/services/otp'

/**
 * Verify a delivered OTP. On success returns a one-time `ticket` (proof of
 * phone ownership) and whether an organizer already exists for this phone,
 * so the client knows to log in or continue with registration.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const parsed = verifyOtpInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid phone or code' }, { status: 400 })
  }

  const { phone, code } = parsed.data

  const result = await verifyOtp(phone, code)
  if (!result.ok) {
    const message = {
      expired: 'Code expired — request a new one',
      invalid: 'Wrong code — check and try again',
      too_many_attempts: 'Too many attempts — request a new code',
    }[result.reason]
    const status = result.reason === 'invalid' ? 400 : 410
    return NextResponse.json({ error: message }, { status })
  }

  const organizer = await db.query.organizers.findFirst({
    where: eq(organizers.phone, phone),
    columns: { id: true },
  })

  const response: VerifyOtpResponse = {
    ticket: result.ticket,
    organizerExists: organizer !== undefined,
  }
  return NextResponse.json(response)
}
