import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { del, get, post, put } from './client'
import { ApiError } from './error'

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockResponse(body: unknown, ok: boolean, status: number) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ── post ──────────────────────────────────────────────────────────────────────

describe('post', () => {
  it('sends a POST with JSON body and returns parsed data on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ id: '1' }, true, 201))

    const result = await post<{ id: string }>('/api/test', { name: 'test' })

    expect(result).toEqual({ id: '1' })
    expect(fetch).toHaveBeenCalledWith('/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test' }),
    })
  })

  it('throws ApiError with server error message on failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ error: 'Slot is full' }, false, 409))

    await expect(post('/api/test', {})).rejects.toMatchObject({
      message: 'Slot is full',
      status: 409,
    })
  })

  it('passes the code field through to ApiError when present', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse({ error: 'You already have a booking', code: 'duplicate_booking' }, false, 409),
    )

    await expect(post('/api/test', {})).rejects.toMatchObject({
      message: 'You already have a booking',
      status: 409,
      code: 'duplicate_booking',
    })
  })

  it('throws ApiError with default message when server sends no error field', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({}, false, 500))

    await expect(post('/api/test', {})).rejects.toMatchObject({
      message: 'Something went wrong — try again',
      status: 500,
    })
  })

  it('throws ApiError with default message when JSON parse fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
    } as unknown as Response)

    await expect(post('/api/test', {})).rejects.toMatchObject({
      message: 'Something went wrong — try again',
      status: 502,
    })
  })

  it('returns data even when response has no error field on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ ok: true }, true, 200))

    const result = await post<{ ok: boolean }>('/api/test', {})
    expect(result).toEqual({ ok: true })
  })
})

// ── get ──────────────────────────────────────────────────────────────────────

describe('get', () => {
  it('sends a GET and returns parsed data on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ name: 'test' }, true, 200))

    const result = await get<{ name: string }>('/api/test')

    expect(result).toEqual({ name: 'test' })
    expect(fetch).toHaveBeenCalledWith('/api/test')
  })

  it('throws ApiError with server error message on failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ error: 'Not found' }, false, 404))

    await expect(get('/api/test')).rejects.toMatchObject({
      message: 'Not found',
      status: 404,
    })
  })

  it('throws ApiError with default message when no error field', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({}, false, 500))

    await expect(get('/api/test')).rejects.toMatchObject({
      message: 'Failed to fetch data',
      status: 500,
    })
  })
})

// ── put ──────────────────────────────────────────────────────────────────────

describe('put', () => {
  it('sends a PUT with JSON body and returns parsed data on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ id: '1', name: 'updated' }, true, 200))

    const result = await put<{ id: string; name: string }>('/api/test', { name: 'updated' })

    expect(result).toEqual({ id: '1', name: 'updated' })
    expect(fetch).toHaveBeenCalledWith('/api/test', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'updated' }),
    })
  })

  it('throws ApiError with server error message on failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ error: 'Conflict' }, false, 409))

    await expect(put('/api/test', {})).rejects.toMatchObject({
      message: 'Conflict',
      status: 409,
    })
  })

  it('throws ApiError with default message when no error field', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({}, false, 500))

    await expect(put('/api/test', {})).rejects.toMatchObject({
      message: 'Update failed — try again',
      status: 500,
    })
  })
})

// ── del ──────────────────────────────────────────────────────────────────────

describe('del', () => {
  it('sends a DELETE and returns parsed data on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ ok: true }, true, 200))

    const result = await del<{ ok: boolean }>('/api/test')

    expect(result).toEqual({ ok: true })
    expect(fetch).toHaveBeenCalledWith('/api/test', { method: 'DELETE' })
  })

  it('throws ApiError with server error message on failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ error: 'Cannot delete' }, false, 400))

    await expect(del('/api/test')).rejects.toMatchObject({
      message: 'Cannot delete',
      status: 400,
    })
  })

  it('throws ApiError with default message when no error field', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({}, false, 500))

    await expect(del('/api/test')).rejects.toMatchObject({
      message: 'Delete failed — try again',
      status: 500,
    })
  })
})

// ── All helpers throw ApiError instances ──────────────────────────────────────

describe('error types', () => {
  it('post throws an ApiError instance', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ error: 'fail' }, false, 400))
    await expect(post('/api/test', {})).rejects.toBeInstanceOf(ApiError)
  })

  it('get throws an ApiError instance', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ error: 'fail' }, false, 400))
    await expect(get('/api/test')).rejects.toBeInstanceOf(ApiError)
  })

  it('put throws an ApiError instance', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ error: 'fail' }, false, 400))
    await expect(put('/api/test', {})).rejects.toBeInstanceOf(ApiError)
  })

  it('del throws an ApiError instance', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ error: 'fail' }, false, 400))
    await expect(del('/api/test')).rejects.toBeInstanceOf(ApiError)
  })
})
