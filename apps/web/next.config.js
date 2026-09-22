import { readFileSync } from 'node:fs'
import process from 'node:process'
import { withSentryConfig } from '@sentry/nextjs'
import createNextIntlPlugin from 'next-intl/plugin'

/** @type {import('next').NextConfig} */

// i18n (ADR-011): locale is cookie/header-driven, not routed.
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

// vercel.json is the single source of truth for /api/* routing (ADR-013).
const vercelConfig = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8'))

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
    // In production Vercel Edge Router executes rewrites from vercel.json natively
    // before entering Next.js. No beforeFiles rewrites needed.
    if (process.env.NODE_ENV === 'production') {
      return { beforeFiles: [], afterFiles: [], fallback: [] }
    }

    // Dev: proxy the routes declared in vercel.json to the local Go server (cmd/dev on :3001).
    const rawOrigin = process.env.GO_API_URL || 'http://127.0.0.1:3001'
    const origin = new URL(rawOrigin)
    if (
      !['http:', 'https:'].includes(origin.protocol) ||
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash ||
      origin.pathname !== '/'
    ) {
      throw new Error('GO_API_URL must be an origin without credentials, path, query or fragment')
    }
    const appUrl = process.env.APP_URL
    if (appUrl && origin.origin === new URL(appUrl).origin) {
      throw new Error('GO_API_URL must differ from APP_URL to avoid a proxy loop')
    }

    return {
      beforeFiles: (vercelConfig.rewrites ?? []).map((r) => ({
        source: r.source,
        destination: `${origin.origin}${r.source}`,
      })),
      afterFiles: [],
      fallback: [],
    }
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
    // Security headers. CSP is assembled from
    // env so every origin the app actually talks to is allowed —
    // hardcoded hosts broke the Telegram login widget, R2 uploads and
    // PostHog in production.
    // Next.js needs 'unsafe-inline' for styles (styled-jsx / inline
    // critical CSS) and 'unsafe-eval' only in dev. The Go API sets its
    // own copies in pkg/httpx (its responses bypass headers()), so both
    // sides of the wire are covered.
    const isDev = process.env.NODE_ENV === 'development'

    // A malformed env value must not take the whole build down — fall
    // back to the documented default origin instead of throwing in
    // new URL().
    const originOf = (value, fallback) => {
      try {
        return new URL(value).origin
      } catch {
        return fallback
      }
    }

    // Media origin: the R2 public base URL (custom domain in prod,
    // *.r2.dev in dev) — organizer avatars and service photos.
    const mediaOrigin = process.env.R2_PUBLIC_BASE_URL
      ? originOf(process.env.R2_PUBLIC_BASE_URL, 'https://*.r2.dev')
      : 'https://*.r2.dev'
    // R2 upload endpoint for the signed-PUT flow (api-client/image.ts).
    const r2UploadOrigin = 'https://*.cloudflarestorage.com'
    // PostHog host (defaults to app.posthog.com per .env.example).
    const posthogOrigin = process.env.NEXT_PUBLIC_POSTHOG_HOST
      ? originOf(process.env.NEXT_PUBLIC_POSTHOG_HOST, 'https://app.posthog.com')
      : 'https://app.posthog.com'
    // Sentry ingest region. instrumentation-client.ts reads
    // NEXT_PUBLIC_SENTRY_DSN ?? SENTRY_DSN, so the CSP must allow
    // whichever one is set.
    const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN
    const sentryOrigin = sentryDsn
      ? originOf(sentryDsn, 'https://o0.ingest.sentry.io')
      : 'https://o0.ingest.sentry.io'

    const csp = [
      "default-src 'self'",
      // Next.js injects inline/bootstrap scripts; nonces are not wired
      // through the App Router here, so script-src allows 'unsafe-inline'
      // for now — the JSON-LD XSS fix (P0-3) escapes payloads, and CSP is
      // the compensating control to tighten later with nonces.
      // telegram.org hosts the login widget script (ADR-008) — the only
      // auth mechanism, so it must load.
      // 'unsafe-eval' is required in production too: telegram-widget.js
      // parses data-onauth via eval and cannot work without it. The
      // JSON-LD XSS vector is closed by escaping, and 'unsafe-inline'
      // is already granted — the marginal loss is
      // small. The long-term fix is the OAuth-redirect flow.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://telegram.org",
      "style-src 'self' 'unsafe-inline'",
      `img-src 'self' data: blob: https://t.me ${mediaOrigin} ${r2UploadOrigin}`,
      "font-src 'self' data:",
      `connect-src 'self' https://*.upstash.io ${sentryOrigin} ${posthogOrigin} ${r2UploadOrigin} ${mediaOrigin}`,
      // The Telegram login widget renders in an iframe from
      // oauth.telegram.org — without frame-src it falls back to
      // default-src 'self' and the widget never appears.
      'frame-src https://oauth.telegram.org',
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; ')

    const securityHeaders = [
      { key: 'Content-Security-Policy', value: csp },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      ...(isDev
        ? []
        : [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]),
    ]

    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
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
