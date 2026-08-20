/** Shared HTTP client utilities for API calls. */

import { ApiError } from './error'

/** The error-carrier envelope every `4xx` body may have. */
type ErrorBody = { error?: string; code?: string } & Record<string, unknown>

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

/** Generic POST helper with error handling. */
export async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as ErrorBody & T
  if (!res.ok) {
    throw new ApiError(data.error ?? POST_ERROR_FALLBACK, res.status, data.code, data)
  }
  return data
}

/** Generic GET helper with error handling. */
export async function get<T>(url: string): Promise<T> {
  const res = await fetch(url)
  const data = (await res.json().catch(() => ({}))) as ErrorBody & T
  if (!res.ok) {
    throw new ApiError(data.error ?? GET_ERROR_FALLBACK, res.status, data.code, data)
  }
  return data
}

/** Generic PUT helper with error handling. */
export async function put<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as ErrorBody & T
  if (!res.ok) {
    throw new ApiError(data.error ?? PUT_ERROR_FALLBACK, res.status, data.code, data)
  }
  return data
}

/** Generic DELETE helper with error handling. */
export async function del<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: 'DELETE' })
  const data = (await res.json().catch(() => ({}))) as ErrorBody & T
  if (!res.ok) {
    throw new ApiError(data.error ?? DELETE_ERROR_FALLBACK, res.status, data.code, data)
  }
  return data
}
