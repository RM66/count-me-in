import type { AvatarUploadTarget } from '@repo/api-contracts'
import { createAvatarUploadInput } from '@repo/api-contracts'
import { NextResponse } from 'next/server'

import { auth } from '@/lib/services/auth'
import { demoReadOnlyResponse, rejectDemoWrite } from '@/lib/services/demo'
import { createAvatarUpload } from '@/lib/services/storage/avatar'

/**
 * Create a signed upload URL for the current organizer's avatar.
 * Returns uploadUrl (direct to R2), publicUrl, and expiresAt.
 */
export async function POST(request: Request) {
  const session = await auth()
  const organizerId = session?.user?.id

  // Read-only demo (ADR-010) — deny before handing out an R2 upload URL,
  // otherwise the demo avatar could be overwritten. Anonymous callers are demo
  // cabinet visitors, so they get the same refusal.
  const denied = rejectDemoWrite(organizerId)
  if (denied || !organizerId) return denied ?? demoReadOnlyResponse()

  const body = await request.json()
  const parsed = createAvatarUploadInput.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const target: AvatarUploadTarget = await createAvatarUpload(organizerId, parsed.data)

  return NextResponse.json(target)
}
