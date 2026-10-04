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
const PATCH_ERROR_FALLBACK = 'Update failed — try again'
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

// A mismatch is reported (throws in tests, logs in dev, Sentry in prod) and
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

type RequestOptions = {
  method: string
  /** Bodies are always JSON; omitted for bodiless methods (GET/DELETE). */
  body?: unknown
  contentType?: 'application/json' | 'application/merge-patch+json'
  /** Per-method English fallback — see the constants above. */
  fallback: string
}

async function request<S extends z.ZodType>(
  url: string,
  schema: S,
  { method, body, contentType, fallback }: RequestOptions,
): Promise<z.input<S>> {
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.headers = { 'Content-Type': contentType ?? 'application/json' }
    init.body = JSON.stringify(body)
  }
  const res = await fetch(url, init)
  if (!res.ok) {
    throwApiError(await readJson(res), res.status, fallback)
  }
  const data: unknown = await readJson(res)
  return checkContract(url, schema, data)
}

/** Generic POST helper with error handling. */
export function post<S extends z.ZodType>(
  url: string,
  body: unknown,
  schema: S,
): Promise<z.input<S>> {
  return request(url, schema, { method: 'POST', body, fallback: POST_ERROR_FALLBACK })
}

/** Generic GET helper with error handling. */
export function get<S extends z.ZodType>(url: string, schema: S): Promise<z.input<S>> {
  return request(url, schema, { method: 'GET', fallback: GET_ERROR_FALLBACK })
}

/**
 * Generic PATCH helper with error handling. The three partial-update
 * endpoints take JSON Merge Patch bodies (RFC 7386, ADR-016) — absent key
 * = keep, explicit null = clear — so they pass the merge-patch media
 * type; everything else keeps application/json.
 */
export function patch<S extends z.ZodType>(
  url: string,
  body: unknown,
  schema: S,
  contentType: 'application/json' | 'application/merge-patch+json' = 'application/json',
): Promise<z.input<S>> {
  return request(url, schema, {
    method: 'PATCH',
    body,
    contentType,
    fallback: PATCH_ERROR_FALLBACK,
  })
}

/** Generic DELETE helper with error handling. */
export function del<S extends z.ZodType>(url: string, schema: S): Promise<z.input<S>> {
  return request(url, schema, { method: 'DELETE', fallback: DELETE_ERROR_FALLBACK })
}
