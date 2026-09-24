import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resizeAvatar, resizeServicePhoto } from './image'

// the browser-side downscale. The signed upload URL commits to an
// exact Content-Type and Content-Length, so the resize contract is:
// never exceed the target edge, never upscale, re-encode as WebP, and
// fail loudly on a non-image.

// ── canvas / bitmap mocks ──────────────────────────────────────────────────────

type FakeBitmap = { width: number; height: number; close: () => void }

let closedBitmaps = 0

function fakeBitmap(width: number, height: number): FakeBitmap {
  return {
    width,
    height,
    close: () => {
      closedBitmaps++
    },
  }
}

let lastDrawArgs:
  | {
      source: FakeBitmap
      sx: number
      sy: number
      sw: number
      sh: number
      dw: number
      dh: number
    }
  | undefined

let lastCanvasSize: { w: number; h: number } | undefined
let lastBlobArgs: { type: string; quality: number } | undefined

class FakeOffscreenCanvas {
  width: number
  height: number
  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    lastCanvasSize = { w: width, h: height }
  }
  getContext() {
    return {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: '',
      drawImage(
        source: FakeBitmap,
        sx: number,
        sy: number,
        sw: number,
        sh: number,
        dx: number,
        dy: number,
        dw: number,
        dh: number,
      ) {
        lastDrawArgs = { source, sx, sy, sw, sh, dw, dh }
      },
    }
  }
  convertToBlob({ type, quality }: { type: string; quality: number }) {
    lastBlobArgs = { type, quality }
    return Promise.resolve(new Blob(['x'], { type }))
  }
}

beforeEach(() => {
  closedBitmaps = 0
  lastDrawArgs = undefined
  lastCanvasSize = undefined
  lastBlobArgs = undefined
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function stubDecode(width: number, height: number, reject = false) {
  vi.stubGlobal(
    'createImageBitmap',
    reject
      ? vi.fn(() => Promise.reject(new Error('decode failed')))
      : vi.fn(() => Promise.resolve(fakeBitmap(width, height))),
  )
}

// ── resizeAvatar ──────────────────────────────────────────────────────────────

describe('resizeAvatar', () => {
  it('center-crops to a square and downscales to the 512px target', async () => {
    stubDecode(1600, 900) // landscape source
    const blob = await resizeAvatar(new Blob(['img']))

    // Center square is the short edge (900), scaled down to 512.
    expect(lastDrawArgs).toMatchObject({ sx: 350, sy: 0, sw: 900, sh: 900, dw: 512, dh: 512 })
    expect(lastCanvasSize).toEqual({ w: 512, h: 512 })
    // Re-encoded as WebP at the pinned quality.
    expect(lastBlobArgs?.type).toBe('image/webp')
    expect(blob.type).toBe('image/webp')
    // The bitmap is released.
    expect(closedBitmaps).toBe(1)
  })

  it('never upscales a small source', async () => {
    stubDecode(300, 300)
    await resizeAvatar(new Blob(['img']))

    // A 300px source keeps its own dimensions — output 300, not 512.
    expect(lastDrawArgs).toMatchObject({ sw: 300, sh: 300, dw: 300, dh: 300 })
  })

  it('rejects a file that cannot be decoded as an image', async () => {
    stubDecode(0, 0, true)
    await expect(resizeAvatar(new Blob(['not an image']))).rejects.toThrow(
      /could not be read as an image/i,
    )
    // The failed decode never produced a bitmap, so nothing to close.
    expect(closedBitmaps).toBe(0)
  })
})

// ── resizeServicePhoto ────────────────────────────────────────────────────────

describe('resizeServicePhoto', () => {
  it('downscales the longest edge to 1280 preserving the aspect ratio', async () => {
    stubDecode(2560, 1440) // 16:9 source
    const blob = await resizeServicePhoto(new Blob(['img']))

    // Whole image drawn (no crop), scaled by 0.5 → 1280×720.
    expect(lastDrawArgs).toMatchObject({ sx: 0, sy: 0, sw: 2560, sh: 1440, dw: 1280, dh: 720 })
    expect(lastCanvasSize).toEqual({ w: 1280, h: 720 })
    expect(blob.type).toBe('image/webp')
    expect(closedBitmaps).toBe(1)
  })

  it('never upscales a small cover', async () => {
    stubDecode(800, 600)
    await resizeServicePhoto(new Blob(['img']))

    expect(lastDrawArgs).toMatchObject({ dw: 800, dh: 600 })
  })

  it('rejects a non-image', async () => {
    stubDecode(0, 0, true)
    await expect(resizeServicePhoto(new Blob(['nope']))).rejects.toThrow(
      /could not be read as an image/i,
    )
  })
})
