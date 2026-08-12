import {
  AVATAR_OUTPUT_CONTENT_TYPE,
  AVATAR_TARGET_SIZE,
  AVATAR_WEBP_QUALITY,
  SERVICE_PHOTO_OUTPUT_CONTENT_TYPE,
  SERVICE_PHOTO_TARGET_SIZE,
  SERVICE_PHOTO_WEBP_QUALITY,
} from '@repo/contracts'

/**
 * Browser-side image downscaling for uploads.
 * Runs before the signed upload URL is requested: the URL commits to an exact
 * Content-Type and Content-Length, so the bytes must be final by then.
 * Keeps stored objects ~50–100× smaller than raw phone photos (see ADR-007).
 * Client-only — depends on canvas / createImageBitmap.
 */

type Canvas = OffscreenCanvas | HTMLCanvasElement

function createCanvas(width: number, height: number): Canvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height)
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function toBlob(canvas: Canvas, type: string, quality: number): Promise<Blob | null> {
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type, quality }).catch(() => null)
  }
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality)
  })
}

/** Decode a file into a bitmap with EXIF orientation already applied. */
async function decode(file: File | Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('That file could not be read as an image')
  }
}

interface DrawRegion {
  sourceX: number
  sourceY: number
  sourceWidth: number
  sourceHeight: number
  outputWidth: number
  outputHeight: number
}

/** Shared encode step: draw the region onto a canvas and re-encode it. */
async function render(
  bitmap: ImageBitmap,
  region: DrawRegion,
  contentType: string,
  quality: number,
): Promise<Blob> {
  const canvas = createCanvas(region.outputWidth, region.outputHeight)
  const ctx = canvas.getContext('2d') as
    OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null

  if (!ctx) {
    throw new Error('Could not process the image in this browser')
  }

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(
    bitmap,
    region.sourceX,
    region.sourceY,
    region.sourceWidth,
    region.sourceHeight,
    0,
    0,
    region.outputWidth,
    region.outputHeight,
  )

  const blob = await toBlob(canvas, contentType, quality)

  if (!blob || blob.size === 0) {
    throw new Error('Could not process the image in this browser')
  }

  return blob
}

/**
 * Decode, center-crop to a square, downscale to at most AVATAR_TARGET_SIZE
 * and re-encode as WebP. Never upscales: a source smaller than the target
 * keeps its own dimensions. The returned blob's `type` is authoritative — a
 * browser without WebP encoding may hand back PNG instead.
 */
export async function resizeAvatar(file: File | Blob): Promise<Blob> {
  const bitmap = await decode(file)

  try {
    const cropSide = Math.min(bitmap.width, bitmap.height)
    const cropX = (bitmap.width - cropSide) / 2
    const cropY = (bitmap.height - cropSide) / 2

    const outputSide = Math.min(AVATAR_TARGET_SIZE, cropSide)

    return await render(
      bitmap,
      {
        sourceX: cropX,
        sourceY: cropY,
        sourceWidth: cropSide,
        sourceHeight: cropSide,
        outputWidth: outputSide,
        outputHeight: outputSide,
      },
      AVATAR_OUTPUT_CONTENT_TYPE,
      AVATAR_WEBP_QUALITY,
    )
  } finally {
    bitmap.close()
  }
}

/**
 * Decode, downscale to fit SERVICE_PHOTO_TARGET_SIZE on the longest edge and
 * re-encode as WebP. Unlike {@link resizeAvatar} this **preserves the aspect
 * ratio** — service covers are displayed in a 16:9 frame with `object-cover`.
 * Never upscales; the returned blob's `type` is authoritative.
 */
export async function resizeServicePhoto(file: File | Blob): Promise<Blob> {
  const bitmap = await decode(file)

  try {
    const longestEdge = Math.max(bitmap.width, bitmap.height)
    const scale = Math.min(1, SERVICE_PHOTO_TARGET_SIZE / longestEdge)

    return await render(
      bitmap,
      {
        sourceX: 0,
        sourceY: 0,
        sourceWidth: bitmap.width,
        sourceHeight: bitmap.height,
        outputWidth: Math.max(1, Math.round(bitmap.width * scale)),
        outputHeight: Math.max(1, Math.round(bitmap.height * scale)),
      },
      SERVICE_PHOTO_OUTPUT_CONTENT_TYPE,
      SERVICE_PHOTO_WEBP_QUALITY,
    )
  } finally {
    bitmap.close()
  }
}
