import process from 'node:process'
import { withSentryConfig } from '@sentry/nextjs'
import createNextIntlPlugin from 'next-intl/plugin'

/** @type {import('next').NextConfig} */

// i18n request config (ADR-011): locale is cookie/header-driven, not routed.
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

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
  transpilePackages: ['@repo/contracts', '@repo/db', '@repo/translations'],
  images: {
    remotePatterns: [
      ...buildRemotePatterns(),
      { protocol: 'https', hostname: 't.me' }, // For Telegram avatars
    ],
  },
  allowedDevOrigins: ['*.tunneler-si.yandex.ru'],
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
        // API error copy is localized per request (ApiErrors dictionaries), so
        // shared caches must key responses by language. Note: App Router pages
        // overwrite `Vary` with Next's internal RSC values — pages rely on
        // being uncached instead; revisit if a shared HTML cache is added.
        source: '/api/:path*',
        headers: [{ key: 'Vary', value: 'Accept-Language' }],
      },
      {
        // Belt-and-braces noindex alongside the meta robots on private pages:
        // headers hold even when the response is not the page's HTML.
        source: '/api/:path*',
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
