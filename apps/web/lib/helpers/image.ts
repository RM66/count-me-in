import {
  AVATAR_OUTPUT_CONTENT_TYPE,
  AVATAR_TARGET_SIZE,
  AVATAR_WEBP_QUALITY,
} from '@repo/api-contracts'

/**
 * Browser-side image downscaling for avatar uploads.
 *
 * Runs before the signed upload URL is requested: the URL commits to an exact
 * Content-Type and Content-Length, so the bytes must be final by then.
 * Keeps stored objects ~50–100× smaller than raw phone photos (see ADR-007).
 *
 * Client-only — depends on canvas / createImageBitmap.
 */

type Canvas = OffscreenCanvas | HTMLCanvasElement

function createCanvas(size: number): Canvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(size, size)
  }
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
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

/**
 * Decode, center-crop to a square, downscale to at most AVATAR_TARGET_SIZE
 * and re-encode as WebP.
 *
 * Never upscales: a source smaller than the target keeps its own dimensions.
 * The returned blob's `type` is authoritative — a browser without WebP encoding
 * support may hand back PNG instead, so callers must read it rather than assume.
 *
 * @throws if the file cannot be decoded as an image or encoding fails.
 */
export async function resizeAvatar(file: File | Blob): Promise<Blob> {
  let bitmap: ImageBitmap
  try {
    // 'from-image' applies EXIF orientation, otherwise phone photos come out rotated.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('That file could not be read as an image')
  }

  try {
    // Center-crop the largest possible square from the source.
    const cropSide = Math.min(bitmap.width, bitmap.height)
    const cropX = (bitmap.width - cropSide) / 2
    const cropY = (bitmap.height - cropSide) / 2

    // Downscale only — never enlarge a small source.
    const outputSide = Math.min(AVATAR_TARGET_SIZE, cropSide)

    const canvas = createCanvas(outputSide)
    const ctx = canvas.getContext('2d') as
      OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null

    if (!ctx) {
      throw new Error('Could not process the image in this browser')
    }

    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, cropX, cropY, cropSide, cropSide, 0, 0, outputSide, outputSide)

    const blob = await toBlob(canvas, AVATAR_OUTPUT_CONTENT_TYPE, AVATAR_WEBP_QUALITY)

    if (!blob || blob.size === 0) {
      throw new Error('Could not process the image in this browser')
    }

    return blob
  } finally {
    bitmap.close()
  }
}
