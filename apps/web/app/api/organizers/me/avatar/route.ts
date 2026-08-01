import type { AvatarUploadTarget } from '@repo/api-contracts'
import { createAvatarUploadInput } from '@repo/api-contracts'
import { NextResponse } from 'next/server'

import { parseJsonBody, requireWritableOrganizer } from '@/lib/server/http'
import { createAvatarUpload } from '@/lib/server/storage/avatar'

/**
 * Create a signed upload URL for the current organizer's avatar.
 * Returns uploadUrl (direct to R2), publicUrl, and expiresAt.
 */
export async function POST(request: Request) {
  // Read-only demo (ADR-010) — deny before handing out an R2 upload URL,
  // otherwise the demo avatar could be overwritten. Anonymous callers are demo
  // cabinet visitors, so they get the same refusal.
  const guard = await requireWritableOrganizer()
  if (!guard.ok) return guard.response
  const { organizerId } = guard.value

  const parsed = await parseJsonBody(request, createAvatarUploadInput)
  if (!parsed.ok) return parsed.response

  const target: AvatarUploadTarget = await createAvatarUpload(organizerId, parsed.value)

  return NextResponse.json(target)
}
