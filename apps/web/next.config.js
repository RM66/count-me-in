import process from 'node:process'
import { withSentryConfig } from '@sentry/nextjs'
import createNextIntlPlugin from 'next-intl/plugin'

import { apiRewrites } from './scripts/api-rewrites.mjs'

/** @type {import('next').NextConfig} */

// i18n (ADR-011): locale is cookie/header-driven, not routed.
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

// R2_PUBLIC_BASE_URL may be the default *.r2.dev domain or a custom domain.
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
  transpilePackages: ['@repo/contracts', '@repo/db', '@repo/redis', '@repo/translations'],
  images: {
    remotePatterns: [
      ...buildRemotePatterns(),
      { protocol: 'https', hostname: 't.me' }, // For Telegram avatars
    ],
  },
  allowedDevOrigins: ['*.tunneler-si.yandex.ru'],
  async rewrites() {
    return apiRewrites({
      goApiUrl: process.env.GO_API_URL,
      production: process.env.NODE_ENV === 'production',
      appUrl: process.env.APP_URL,
    })
  },
  async redirects() {
    return [
      {
        // One canonical host for the apex deployment; preview/staging domains
        // use other hostnames and never match.
        source: '/:path*',
        has: [{ type: 'host', value: 'www.countmein.group' }],
        destination: 'https://countmein.group/:path*',
        permanent: true,
      },
    ]
  },
  async headers() {
    return [
      {
        // In production Vercel's filesystem routing serves Go functions at
        // /api/* directly (bypassing headers()); Go sets its own Vary /
        // X-Robots-Tag. In dev, beforeFiles rewrites proxy /api/* to the
        // local Go server (also bypassing headers()). Only the Auth.js route
        // stays on Next.js and needs noindex here.
        source: '/api/auth/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex' }],
      },
      {
        source: '/login/link/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex' }],
      },
    ]
  },
}

// Source-map upload only runs in CI with SENTRY_AUTH_TOKEN; no-op otherwise.
export default withNextIntl(
  withSentryConfig(nextConfig, {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    silent: !process.env.CI,
    disableSourceMapUpload: !process.env.SENTRY_AUTH_TOKEN,
  }),
)
