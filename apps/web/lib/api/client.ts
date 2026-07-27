/**
 * Shared HTTP client utilities for API calls.
 * Used by both queries and mutations.
 */

import { ApiError } from './error'

/**
 * Generic POST helper with error handling.
 * Throws ApiError on non-2xx responses.
 */
export async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T
  if (!res.ok) {
    throw new ApiError(data.error ?? 'Something went wrong — try again', res.status)
  }
  return data
}

/**
 * Generic GET helper with error handling.
 * Throws ApiError on non-2xx responses.
 */
export async function get<T>(url: string): Promise<T> {
  const res = await fetch(url)
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T
  if (!res.ok) {
    throw new ApiError(data.error ?? 'Failed to fetch data', res.status)
  }
  return data
}

/**
 * Generic PUT helper with error handling.
 * Throws ApiError on non-2xx responses.
 */
export async function put<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T
  if (!res.ok) {
    throw new ApiError(data.error ?? 'Update failed — try again', res.status)
  }
  return data
}

/**
 * Generic DELETE helper with error handling.
 * Throws ApiError on non-2xx responses.
 */
export async function del<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: 'DELETE' })
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T
  if (!res.ok) {
    throw new ApiError(data.error ?? 'Delete failed — try again', res.status)
  }
  return data
}
