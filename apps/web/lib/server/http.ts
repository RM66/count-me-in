/**
 * Route-handler plumbing shared by `app/api/**\/route.ts`.
 *
 * Every mutating endpoint opens with the same moves — establish *who* is calling
 * and *whether they may write*, then parse the body against a Zod schema — and
 * each one has its own way to get them subtly wrong. These helpers make the
 * sequence a single expression per handler.
 *
 * They return a **discriminated union** rather than `T | NextResponse`: a bare
 * union would force every caller to type-test the response object, and an
 * accidental `if (!result)` would silently treat a `403` as success.
 *
 * **Scope:** request-level concerns only — sessions, tickets, body parsing. This
 * module must not import from `./db/`: mapping an entity's failure modes onto
 * status codes belongs to the handler that knows the entity, not here. Putting it
 * here inverts the dependency, so that generic plumbing would need editing every
 * time a new entity grows a new error.
 */

import type { NextResponse } from 'next/server'
import { NextResponse as Response } from 'next/server'
import { z } from 'zod'

import { auth } from './auth'
import { type AuthTicketPayload, consumeTicket } from './auth/ticket'
import { rejectDemoWrite } from './demo'

import 'server-only'

/**
 * Either a usable value or a response to return as-is. Check `ok` — never
 * truthiness of the value.
 */
export type Guarded<T> = { ok: true; value: T } | { ok: false; response: NextResponse }

/**
 * The organizer allowed to **write** in this request.
 *
 * Anonymous callers are demo-cabinet visitors (`/cabinet` needs no session,
 * ADR-010), so they get the same `DEMO_READ_ONLY` refusal as the demo id itself
 * rather than a bare `401` — the message tells them to sign up, which is the
 * actual next step.
 *
 * ```ts
 * const guard = await requireWritableOrganizer()
 * if (!guard.ok) return guard.response
 * const { organizerId } = guard.value
 * ```
 */
export async function requireWritableOrganizer(): Promise<Guarded<{ organizerId: string }>> {
  const session = await auth()
  const organizerId = session?.user?.id

  const denied = rejectDemoWrite(organizerId)
  // `rejectDemoWrite` already covers the anonymous case; the `!organizerId`
  // test is what narrows the id to a string for TypeScript.
  if (denied || !organizerId) {
    return {
      ok: false,
      response: denied ?? Response.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  return { ok: true, value: { organizerId } }
}

/**
 * Parse a JSON body against `schema`, answering `400` on malformed JSON or a
 * schema violation.
 *
 * `request.json()` is caught rather than left to throw: a body that is not JSON
 * at all is a client error, and an uncaught throw here would surface as a `500`.
 */
export async function parseJsonBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<Guarded<z.infer<S>>> {
  const body = await request.json().catch(() => null)
  const parsed = schema.safeParse(body)

  if (!parsed.success) {
    // Surface the first issue as `error`. The client renders that field
    // verbatim in a toast, and a bare "Invalid input" tells the organizer
    // nothing about which rule they broke. `details` still carries the rest.
    const [first] = parsed.error.issues

    return {
      ok: false,
      response: Response.json(
        {
          error: first?.message ?? 'Invalid input',
          details: z.flattenError(parsed.error),
        },
        { status: 400 },
      ),
    }
  }

  return { ok: true, value: parsed.data }
}

/**
 * Redeem a guest auth ticket for the messenger identity behind it.
 *
 * The guest counterpart of {@link requireWritableOrganizer}, and here for the
 * same reason: both answer "who is calling, and may they write" from a
 * credential on the request. Organizers carry a session cookie, guests a ticket
 * (they have no Auth.js account at all — ADR-002) — the credential differs, the
 * concern does not.
 *
 * The ticket is **consumed**, not peeked: it is a one-shot proof of identity, so
 * a replayed request finds nothing and is refused. (Organizer signup peeks
 * instead, because the same ticket is deliberately reused for the subsequent
 * `signIn` — see `/api/organizers`.)
 *
 * This is the only way a guest identity may enter a write: invariant 8 says it
 * comes from a server-validated widget payload, never from raw client input.
 *
 * `401` on an expired or already-spent ticket — the guest has to tap the widget
 * again, which the message says.
 */
export async function requireGuestIdentity(ticket: string): Promise<Guarded<AuthTicketPayload>> {
  const payload = await consumeTicket(ticket)

  if (!payload) {
    return {
      ok: false,
      response: Response.json(
        { error: 'Your Telegram confirmation expired — authenticate again' },
        { status: 401 },
      ),
    }
  }

  return { ok: true, value: payload }
}
