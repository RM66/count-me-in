/** Shared HTTP client utilities for API calls. */

import { errorBody } from '@repo/contracts'
import { z } from 'zod'

import { reportContractViolation, schemaIdOf } from './contract'
import { ApiError } from './error'

/**
 * Last-resort English fallbacks for responses that carry no server message
 * (non-JSON body, proxy error page, …). api-client has no locale to translate
 * with, so the *display site* supplies localized copy via
 * `error.message || t(...)` — these exist so logs, devtools and any missed
 * call site stay readable instead of showing an empty toast. Named constants
 * rather than inline literals: the no-untranslated-strings rule treats them as
 * an intentional, documented fallback.
 */
const POST_ERROR_FALLBACK = 'Something went wrong — try again'
const GET_ERROR_FALLBACK = 'Failed to fetch data'
const PUT_ERROR_FALLBACK = 'Update failed — try again'
const DELETE_ERROR_FALLBACK = 'Delete failed — try again'

function throwApiError(data: unknown, status: number, fallback: string): never {
  const parsed = errorBody.safeParse(data)
  if (parsed.success) {
    throw new ApiError(
      parsed.data.error || fallback,
      status,
      parsed.data.code,
      data as Record<string, unknown>,
    )
  }
  throw new ApiError(fallback, status, undefined, data as Record<string, unknown>)
}

async function readJson(res: Response): Promise<unknown> {
  return res.json().catch(() => ({}))
}

// D7: a mismatch is reported (throws in tests, logs in dev, Sentry in prod) and
// the raw body is handed back, so a contract drift degrades the type rather
// than the page. The return type is therefore the *input* side of the schema:
// the value is what the server sent, not what a successful parse would produce.
function checkContract<S extends z.ZodType>(url: string, schema: S, data: unknown): z.input<S> {
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    reportContractViolation(url, schemaIdOf(schema), parsed.error)
  }
  return data as z.input<S>
}

/** Generic POST helper with error handling. */
export async function post<S extends z.ZodType>(
  url: string,
  body: unknown,
  schema: S,
): Promise<z.input<S>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throwApiError(await readJson(res), res.status, POST_ERROR_FALLBACK)
  }
  const data: unknown = await readJson(res)
  return checkContract(url, schema, data)
}

/** Generic GET helper with error handling. */
export async function get<S extends z.ZodType>(url: string, schema: S): Promise<z.input<S>> {
  const res = await fetch(url)
  if (!res.ok) {
    throwApiError(await readJson(res), res.status, GET_ERROR_FALLBACK)
  }
  const data: unknown = await readJson(res)
  return checkContract(url, schema, data)
}

/**
 * Generic PUT helper with error handling. The three partial-update
 * endpoints take JSON Merge Patch bodies (RFC 7386, ADR-016) — absent key
 * = keep, explicit null = clear — so they pass the merge-patch media
 * type; everything else keeps application/json.
 */
export async function put<S extends z.ZodType>(
  url: string,
  body: unknown,
  schema: S,
  contentType: 'application/json' | 'application/merge-patch+json' = 'application/json',
): Promise<z.input<S>> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throwApiError(await readJson(res), res.status, PUT_ERROR_FALLBACK)
  }
  const data: unknown = await readJson(res)
  return checkContract(url, schema, data)
}

/** Generic DELETE helper with error handling. */
export async function del<S extends z.ZodType>(url: string, schema: S): Promise<z.input<S>> {
  const res = await fetch(url, { method: 'DELETE' })
  if (!res.ok) {
    throwApiError(await readJson(res), res.status, DELETE_ERROR_FALLBACK)
  }
  const data: unknown = await readJson(res)
  return checkContract(url, schema, data)
}
