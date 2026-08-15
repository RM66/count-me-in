/**
 * R2 environment variables — lazy validation (throw on first use).
 */

interface R2Config {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  publicBaseUrl: string
}

let cachedConfig: R2Config | null = null

export function getR2Config(): R2Config {
  if (cachedConfig) return cachedConfig

  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_BUCKET
  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL

  if (!accountId) {
    throw new Error('R2_ACCOUNT_ID is not set')
  }
  if (!accessKeyId) {
    throw new Error('R2_ACCESS_KEY_ID is not set')
  }
  if (!secretAccessKey) {
    throw new Error('R2_SECRET_ACCESS_KEY is not set')
  }
  if (!bucket) {
    throw new Error('R2_BUCKET is not set')
  }
  if (!publicBaseUrl) {
    throw new Error('R2_PUBLIC_BASE_URL is not set')
  }

  cachedConfig = {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    publicBaseUrl,
  }

  return cachedConfig
}
