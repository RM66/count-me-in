/**
 * Route-handler plumbing shared by `app/api/**\/route.ts`.
 *
 * Every mutating endpoint opens with the same three moves — resolve the
 * session, refuse demo/anonymous writes (ADR-010), parse the body against a Zod
 * schema — and each one has its own way to get them subtly wrong. These helpers
 * make the sequence a single expression per handler.
 *
 * They return a **discriminated union** rather than `T | NextResponse`: a bare
 * union would force every caller to type-test the response object, and an
 * accidental `if (!result)` would silently treat a `403` as success.
 */

import type { NextResponse } from 'next/server'
import { NextResponse as Response } from 'next/server'
import type { z } from 'zod'

import { auth } from './auth'
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
    return {
      ok: false,
      response: Response.json(
        { error: 'Invalid input', details: parsed.error.flatten() },
        { status: 400 },
      ),
    }
  }

  return { ok: true, value: parsed.data }
}
