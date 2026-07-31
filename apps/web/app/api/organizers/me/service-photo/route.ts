import type { ImageUploadTarget } from '@repo/api-contracts'
import { createServicePhotoUploadInput } from '@repo/api-contracts'
import { NextResponse } from 'next/server'

import { auth } from '@/lib/services/auth'
import { demoReadOnlyResponse, rejectDemoWrite } from '@/lib/services/demo'
import { createServicePhotoUpload } from '@/lib/services/storage/service-photo'

/**
 * Create a signed upload URL for a service cover photo.
 *
 * Lives under `organizers/me` rather than `services/{id}` on purpose: the "new
 * service" form uploads a cover *before* the service row exists, so the only
 * identity available at that point is the organizer's. The resulting key is
 * organizer-scoped, which is also what the `photoUrl` ownership check validates.
 */
export async function POST(request: Request) {
  const session = await auth()
  const organizerId = session?.user?.id

  // Read-only demo (ADR-010) — deny before handing out an R2 upload URL.
  // Anonymous callers are demo cabinet visitors, so they get the same refusal.
  const denied = rejectDemoWrite(organizerId)
  if (denied || !organizerId) return denied ?? demoReadOnlyResponse()

  const body = await request.json()
  const parsed = createServicePhotoUploadInput.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const target: ImageUploadTarget = await createServicePhotoUpload(organizerId, parsed.data)

  return NextResponse.json(target)
}
