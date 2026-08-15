/**
 * Signed upload URL generation for Cloudflare R2.
 */
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import { getR2Client } from './client'
import { getR2Config } from './env'

export interface CreateSignedUploadUrlParams {
  key: string
  contentType: string
  contentLength: number
  expiresIn?: number // seconds, default 600 (10 minutes)
}

export interface SignedUploadUrl {
  uploadUrl: string
  expiresAt: string // ISO timestamp
}

/**
 * Create a signed PUT URL for direct browser upload to R2.
 * The signature enforces Content-Type and Content-Length, so the browser
 * PUT must match them exactly (R2 will reject mismatched requests).
 */
export async function createSignedUploadUrl({
  key,
  contentType,
  contentLength,
  expiresIn = 600,
}: CreateSignedUploadUrlParams): Promise<SignedUploadUrl> {
  const config = getR2Config()
  const client = getR2Client()

  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  })

  const uploadUrl = await getSignedUrl(client, command, { expiresIn })
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()

  return { uploadUrl, expiresAt }
}
