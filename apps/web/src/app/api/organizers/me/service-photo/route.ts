import type { ImageUploadTarget } from '@repo/api-contracts'
import { createServicePhotoUploadInput } from '@repo/api-contracts'
import { NextResponse } from 'next/server'

import { parseJsonBody, requireWritableOrganizer } from '@/server/http'
import { createServicePhotoUpload } from '@/server/storage/service-photo'

/**
 * Create a signed upload URL for a service cover photo.
 *
 * Lives under `organizers/me` rather than `services/{id}` on purpose: the "new
 * service" form uploads a cover *before* the service row exists, so the only
 * identity available at that point is the organizer's. The resulting key is
 * organizer-scoped, which is also what the `photoUrl` ownership check validates.
 */
export async function POST(request: Request) {
  // Read-only demo (ADR-010) — deny before handing out an R2 upload URL.
  // Anonymous callers are demo cabinet visitors, so they get the same refusal.
  const guard = await requireWritableOrganizer()
  if (!guard.ok) return guard.response
  const { organizerId } = guard.value

  const parsed = await parseJsonBody(request, createServicePhotoUploadInput)
  if (!parsed.ok) return parsed.response

  const target: ImageUploadTarget = await createServicePhotoUpload(organizerId, parsed.value)

  return NextResponse.json(target)
}
