import process from 'node:process'
import { withSentryConfig } from '@sentry/nextjs'

/** @type {import('next').NextConfig} */

// Allow next/image to optimise images served from the R2 public bucket.
// R2_PUBLIC_BASE_URL can be either the default *.r2.dev domain or a custom domain
// (e.g. https://media.countmein.group).
function buildRemotePatterns() {
  const raw = process.env.R2_PUBLIC_BASE_URL
  if (!raw) {
    // Dev fallback: permit all Cloudflare R2 public-bucket hostnames.
    return [
      { protocol: 'https', hostname: '*.r2.dev' },
      { protocol: 'https', hostname: '*.cloudflarestorage.com' },
    ]
  }

  try {
    const { protocol, hostname } = new URL(raw)
    return [{ protocol: protocol.replace(':', ''), hostname }]
  } catch {
    return []
  }
}

const nextConfig = {
  transpilePackages: ['@repo/contracts', '@repo/db'],
  images: {
    remotePatterns: [
      ...buildRemotePatterns(),
      { protocol: 'https', hostname: 't.me' }, // For Telegram avatars
    ],
  },
  allowedDevOrigins: ['*.tunneler-si.yandex.ru'],
}

// Source-map upload only runs in CI with SENTRY_AUTH_TOKEN; no-op otherwise.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  disableSourceMapUpload: !process.env.SENTRY_AUTH_TOKEN,
})
