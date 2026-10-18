import {
  DEMO_ORGANIZER_ID,
  REALTIME_CHANNEL_ORGANIZER_PREFIX,
  REALTIME_CHANNEL_SERVICE_PREFIX,
  serviceId,
  uuid,
} from '@repo/contracts'
import { handle } from '@upstash/realtime'
import { NextResponse } from 'next/server'

import { auth } from '@/server/auth'
import { realtime } from '@/server/realtime'

/**
 * GET /api/realtime — the SSE endpoint for live slot occupancy
 * (ADR-025). The SDK handler replays stream history, then forwards
 * pub/sub for the subscribed channels.
 *
 * The third permanent Next.js keeper (with `auth/[...nextauth]` and
 * `internal/revalidate`) — SSE is a Next.js runtime primitive here.
 * `proxy.ts` excludes the path from middleware; the channel
 * authorization below is its own, not the organizer-auth mint.
 *
 * Channel policy — the whole subscription is refused if any channel is
 * forbidden (a partial allow would let a client probe):
 *
 * - `service:{id}` — public; occupancy is already public data.
 * - `organizer:{id}` — requires a session whose user id matches; the
 *   demo organizer id is refused outright.
 */
// Machine-readable refusal — not user-visible copy (the EventSource
// client never renders it), so the api-error namespace does not apply.
const CODE_FORBIDDEN = 'forbidden'
const CODE_TOO_MANY_CHANNELS = 'too_many_channels'

// The Subscriber opens one streaming HTTP connection per channel — an
// uncapped list is a fan-out amplifier. Pages subscribe to one; ten is
// headroom. `handle()` dedupes first, so length bounds distinct count.
const MAX_CHANNELS = 10

async function authorizeChannels(channels: string[]): Promise<NextResponse | void> {
  if (channels.length > MAX_CHANNELS) {
    return NextResponse.json({ error: CODE_TOO_MANY_CHANNELS }, { status: 400 })
  }
  const organizerIds: string[] = []
  for (const channel of channels) {
    if (channel.startsWith(REALTIME_CHANNEL_SERVICE_PREFIX)) {
      // Public, but the id must parse — a malformed channel opens a
      // subscribe connection that can never carry an event.
      const id = channel.slice(REALTIME_CHANNEL_SERVICE_PREFIX.length)
      if (!serviceId.safeParse(id).success) {
        return NextResponse.json({ error: CODE_FORBIDDEN }, { status: 403 })
      }
      continue
    }
    if (!channel.startsWith(REALTIME_CHANNEL_ORGANIZER_PREFIX)) {
      return NextResponse.json({ error: CODE_FORBIDDEN }, { status: 403 })
    }
    const id = channel.slice(REALTIME_CHANNEL_ORGANIZER_PREFIX.length)
    // Demo id refused outright; a malformed id never resolves anyway.
    if (!uuid.safeParse(id).success || id === DEMO_ORGANIZER_ID) {
      return NextResponse.json({ error: CODE_FORBIDDEN }, { status: 403 })
    }
    organizerIds.push(id)
  }
  if (organizerIds.length === 0) return
  const session = await auth()
  for (const id of organizerIds) {
    if (session?.user?.id !== id) {
      return NextResponse.json({ error: CODE_FORBIDDEN }, { status: 403 })
    }
  }
}

// The stream is a live connection, not a renderable response.
export const dynamic = 'force-dynamic'

// Fluid Compute: the handler closes the stream just before this, so the
// client reconnects on a fresh function. A LITERAL on purpose — Next.js
// reads segment config statically and an imported constant fails the
// build. `REALTIME_MAX_DURATION_S` carries the same number; the pair is
// pinned by route.test.ts.
export const maxDuration = 300

export const GET = handle({
  realtime,
  middleware: ({ channels }) => authorizeChannels(channels),
})
