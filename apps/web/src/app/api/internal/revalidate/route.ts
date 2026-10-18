import { timingSafeEqual } from 'node:crypto'
import {
  DEMO_ORGANIZER_ID,
  REALTIME_EVENT_SLOT_OCCUPANCY,
  realtimeChannels,
  slotOccupancyEvent,
} from '@repo/contracts'
import { revalidateTag } from 'next/cache'
import { NextResponse } from 'next/server'

import { derivedInternalSecret, INTERNAL_SECRET_HEADER } from '@/server/internal-api'
import { realtime, realtimeConfigured } from '@/server/realtime'

/**
 * POST /api/internal/revalidate — on-demand Data Cache invalidation
 * (ADR-023). Public SSR reads are cached under `public-organizer:{slug}`,
 * `public-service:{id}`, `public-sitemap` tags with a 60s TTL; the
 * Python API POSTs affected tags after a committed mutation so pages go
 * stale immediately.
 *
 * Lives on Next.js: `revalidateTag` is a runtime primitive. `proxy.ts`
 * excludes the path (else the container twin would rewrite it to
 * API_URL); auth is the internal service secret — the caller is the
 * Python API itself.
 *
 * The body may also carry `occupancy` — the channel-target signal a
 * committed seat/capacity change produces (ADR-025). The route emits it
 * as `slot.occupancy` on service + organizer channels via
 * `@upstash/realtime`, which owns the wire format — Python describes
 * *what* changed, never *how* it is encoded.
 *
 * Failure contract: non-2xx is best-effort for the caller (TTL covers
 * it). The emit leg fails open the same way — an outage or unconfigured
 * pair answers 200 with `emitted: false`; the demo id never reaches the
 * channels.
 */

// Only the public-cache tag families — the allowlist keeps the blast
// radius to exactly the tags api-client.ts writes.
const ALLOWED_TAG = /^public-(organizer|service|sitemap)(:[a-zA-Z0-9_-]{1,64})?$/

const MAX_TAGS = 32

// Machine-readable wire codes for the Python caller (status + code is
// the contract — this endpoint has no user-facing copy to translate).
const CODE_UNAUTHORIZED = 'unauthorized'
const CODE_INVALID_JSON = 'invalid JSON'
const CODE_BAD_TAGS = 'tags must be a non-empty array'
const CODE_UNSUPPORTED_TAG = 'unsupported tag'
const CODE_BAD_OCCUPANCY = 'unsupported occupancy'

function authorized(request: Request): boolean {
  const authSecret = process.env.AUTH_SECRET
  if (!authSecret) return false
  const given = request.headers.get(INTERNAL_SECRET_HEADER) ?? ''
  const expected = derivedInternalSecret(authSecret)
  // timingSafeEqual requires equal-length buffers; a length miss is a
  // clean 401, never a throw.
  if (given.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(given, 'utf8'), Buffer.from(expected, 'utf8'))
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: CODE_UNAUTHORIZED }, { status: 401 })
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: CODE_INVALID_JSON }, { status: 400 })
  }
  const record =
    body && typeof body === 'object' ? (body as { tags?: unknown; occupancy?: unknown }) : {}
  const tags = record.tags
  if (!Array.isArray(tags) || tags.length === 0 || tags.length > MAX_TAGS) {
    return NextResponse.json({ error: CODE_BAD_TAGS }, { status: 400 })
  }
  for (const tag of tags) {
    if (typeof tag !== 'string' || !ALLOWED_TAG.test(tag)) {
      return NextResponse.json({ error: CODE_UNSUPPORTED_TAG }, { status: 400 })
    }
  }
  for (const tag of tags as string[]) {
    // 'max' — stale-while-revalidate (the classic single-arg
    // semantics; Next 16 requires the profile arg).
    revalidateTag(tag, 'max')
  }
  // Revalidate first so a malformed occupancy payload never blocks the
  // primary Data Cache invalidation; still answer 400 so Python↔contracts
  // drift surfaces in logs and tests.
  const occupancy =
    record.occupancy === undefined ? undefined : slotOccupancyEvent.safeParse(record.occupancy)
  if (occupancy !== undefined && !occupancy.success) {
    return NextResponse.json({ error: CODE_BAD_OCCUPANCY, revalidated: true }, { status: 400 })
  }

  let emitted = false
  // Without a resolved REST pair the SDK only warns — emitting anyway
  // would report `emitted: true` for an event that went nowhere. The
  // demo id is refused on subscribe; the emit must not spend a publish
  // on it either (second fence — Python already drops it).
  if (
    realtimeConfigured &&
    occupancy?.success &&
    occupancy.data.organizerId !== DEMO_ORGANIZER_ID
  ) {
    const channels = [
      realtimeChannels.service(occupancy.data.serviceId),
      realtimeChannels.organizer(occupancy.data.organizerId),
    ]
    const results = await Promise.allSettled(
      channels.map((channel) =>
        realtime.channel(channel).emit(REALTIME_EVENT_SLOT_OCCUPANCY, occupancy.data),
      ),
    )
    emitted = results.every((result) => result.status === 'fulfilled')
    for (const [i, result] of results.entries()) {
      // Fail-open (ADR-025): the write committed and the tags
      // revalidated — an outage must not turn this hop into a 5xx.
      // allSettled so the warning names the failed channel.
      if (result.status === 'rejected') {
        console.warn('[realtime] occupancy emit failed', channels[i], result.reason)
      }
    }
  }
  return NextResponse.json({ revalidated: true, tags, emitted })
}
