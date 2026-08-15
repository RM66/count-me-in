import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadRemoteImageDataUri } from './assets'

// A tiny valid PNG so the helper's base64 output is deterministic.
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00])

describe('loadRemoteImageDataUri', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('inlines a fetched image as a data URI', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'image/png' },
        arrayBuffer: async () => PNG_BYTES,
      }),
    )

    const result = await loadRemoteImageDataUri('https://media.example.com/avatar.png')

    expect(result).toBe(`data:image/png;base64,${PNG_BYTES.toString('base64')}`)
  })

  it('returns null when the response is not an image', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'text/html' },
        arrayBuffer: async () => Buffer.from('<html></html>'),
      }),
    )

    const result = await loadRemoteImageDataUri('https://media.example.com/not-an-image')

    expect(result).toBeNull()
  })

  it('returns null when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    const result = await loadRemoteImageDataUri('https://media.example.com/avatar.png')

    expect(result).toBeNull()
  })

  it('returns null when the response is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        headers: { get: () => 'image/png' },
        arrayBuffer: async () => Buffer.alloc(0),
      }),
    )

    const result = await loadRemoteImageDataUri('https://media.example.com/missing.png')

    expect(result).toBeNull()
  })

  it('inlines a relative public asset from disk', async () => {
    // The demo seed's photoUrl is a relative public path (e.g.
    // `/organizer-avatar.png`); it must be read from disk, not fetched.
    const result = await loadRemoteImageDataUri('/logo.svg')

    expect(result).toMatch(/^data:image\/svg\+xml;base64,/)
  })

  it('returns null for a relative path with an unknown extension', async () => {
    const result = await loadRemoteImageDataUri('/some-file.bin')

    expect(result).toBeNull()
  })
})
