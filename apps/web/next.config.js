import process from 'node:process'

/** @type {import('next').NextConfig} */

// Allow next/image to optimise images served from the R2 public bucket.
// R2_PUBLIC_URL can be either the default *.r2.dev domain or a custom domain
// (e.g. https://assets.countmein.group).
function buildRemotePatterns() {
  const raw = process.env.R2_PUBLIC_URL
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
  transpilePackages: ['@repo/api-contracts', '@repo/db'],
  images: {
    remotePatterns: buildRemotePatterns(),
  },
  allowedDevOrigins: ['*.tunneler-si.yandex.ru'],
}

export default nextConfig
