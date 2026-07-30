import type { AvatarUploadTarget } from '@repo/api-contracts'
import { createAvatarUploadInput } from '@repo/api-contracts'
import { NextResponse } from 'next/server'

import { auth } from '@/lib/services/auth'
import { createAvatarUpload } from '@/lib/services/storage/avatar'

/**
 * Create a signed upload URL for the current organizer's avatar.
 * Returns uploadUrl (direct to R2), publicUrl, and expiresAt.
 */
export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const parsed = createAvatarUploadInput.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const target: AvatarUploadTarget = await createAvatarUpload(session.user.id, parsed.data)

  return NextResponse.json(target)
}
