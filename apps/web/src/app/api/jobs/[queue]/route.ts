import { Receiver } from '@upstash/qstash'
import { NextResponse } from 'next/server'

import { InvalidJobPayloadError, runJob, UnknownJobQueueError } from '@/server/jobs/run'

type RouteContext = { params: Promise<{ queue: string }> }

/**
 * POST /api/jobs/{queue} — the QStash receiver (ADR-012).
 *
 * Everything QStash delivers lands here: `booking.created` and
 * `booking.cancelled` published after the booking transaction commits, and the
 * `demo.refresh` schedule. The only caller is QStash itself, so authorization
 * is its per-request signature (`upstash-signature`, verified with the
 * signing keys) rather than a session or ticket — and every response body is
 * empty, because the consumer is a queue that reads status codes, not copy.
 *
 * Status semantics are the queue's retry budget:
 *
 * - `200` — delivered, or deliberately completed (recipient unreachable).
 * - `400` — malformed payload; retrying would resend the same bad bytes.
 * - `401` — missing/invalid signature.
 * - `404` — unknown queue name (e.g. a destination configured for another app).
 * - `500` — handler failure; **this is what makes QStash retry**.
 */
export async function POST(request: Request, { params }: RouteContext) {
  const { queue } = await params

  // The signature covers the exact bytes of the body, so it must be read as
  // text and verified before anything parses it.
  const body = await request.text()
  const signature = request.headers.get('upstash-signature')

  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY
  if (!currentSigningKey || !nextSigningKey) {
    console.error('[jobs] QSTASH_CURRENT_SIGNING_KEY / QSTASH_NEXT_SIGNING_KEY are not set')
    return new NextResponse(null, { status: 500 })
  }

  if (!signature) {
    return new NextResponse(null, { status: 401 })
  }

  const receiver = new Receiver({ currentSigningKey, nextSigningKey })
  if (!(await receiver.verify({ body, signature }))) {
    return new NextResponse(null, { status: 401 })
  }

  let payload: unknown
  try {
    payload = body ? JSON.parse(body) : undefined
  } catch {
    return new NextResponse(null, { status: 400 })
  }

  try {
    await runJob(queue, payload)
    return new NextResponse(null, { status: 200 })
  } catch (error) {
    if (error instanceof UnknownJobQueueError || error instanceof InvalidJobPayloadError) {
      return new NextResponse(null, { status: error instanceof UnknownJobQueueError ? 404 : 400 })
    }
    // Anything else is a handler failure — let it escape as a 500 so QStash
    // retries the delivery (and Sentry captures it via instrumentation).
    throw error
  }
}
