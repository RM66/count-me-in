import { timingSafeEqual } from 'node:crypto'
import { revalidateTag } from 'next/cache'
import { NextResponse } from 'next/server'

import { derivedInternalSecret, INTERNAL_SECRET_HEADER } from '@/server/internal-api'

/**
 * POST /api/internal/revalidate — on-demand Data Cache invalidation
 * (ADR-023 Phase 3).
 *
 * Public SSR reads are cached in the Next.js Data Cache under
 * `public-organizer:{slug}`, `public-service:{id}` and `public-sitemap`
 * tags with a 60s TTL fallback. The Python API POSTs the affected tags
 * here after a committed mutation so the public page goes stale
 * immediately instead of at the next TTL.
 *
 * Lives on Next.js, not the Python API: `revalidateTag` is a Next.js
 * runtime primitive. `proxy.ts` excludes this path from the middleware
 * (it would otherwise be rewritten to API_URL in the container twin),
 * and the filesystem route wins over the catch-all `/api/internal/:path*`
 * rewrite in `vercel.json`. Auth is the internal service secret, not the
 * organizer-auth middleware — the caller is the Python API itself.
 *
 * Failure contract: the caller treats any non-2xx as best-effort and
 * falls back to the TTL; a refused call only delays visibility.
 */

// Only the public-cache tag families may be invalidated from here. An
// arbitrary-tags endpoint would let anyone holding (or guessing) the
// credential poke at unrelated cache entries — the allowlist keeps the
// blast radius to exactly the tags api-client.ts writes.
const ALLOWED_TAG = /^public-(organizer|service|sitemap)(:[a-zA-Z0-9_-]{1,64})?$/

const MAX_TAGS = 32

// Machine-readable wire codes for the Python caller (status + code is
// the contract — this endpoint has no user-facing copy to translate).
const CODE_UNAUTHORIZED = 'unauthorized'
const CODE_INVALID_JSON = 'invalid JSON'
const CODE_BAD_TAGS = 'tags must be a non-empty array'
const CODE_UNSUPPORTED_TAG = 'unsupported tag'

function authorized(request: Request): boolean {
  const authSecret = process.env.AUTH_SECRET
  if (!authSecret) return false
  const given = request.headers.get(INTERNAL_SECRET_HEADER) ?? ''
  const expected = derivedInternalSecret(authSecret)
  // timingSafeEqual requires equal-length buffers; a length miss is a
  // clean 401, never a throw.
  if (given.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(given, 'utf8'), Buffer.from(expected, 'utf8'))
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: CODE_UNAUTHORIZED }, { status: 401 })
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: CODE_INVALID_JSON }, { status: 400 })
  }
  const tags = body && typeof body === 'object' ? (body as { tags?: unknown }).tags : undefined
  if (!Array.isArray(tags) || tags.length === 0 || tags.length > MAX_TAGS) {
    return NextResponse.json({ error: CODE_BAD_TAGS }, { status: 400 })
  }
  for (const tag of tags) {
    if (typeof tag !== 'string' || !ALLOWED_TAG.test(tag)) {
      return NextResponse.json({ error: CODE_UNSUPPORTED_TAG }, { status: 400 })
    }
  }
  for (const tag of tags as string[]) {
    // 'max' — the built-in stale-while-revalidate profile: entries are
    // marked stale and revalidated on the next read (the classic
    // single-argument semantics; Next 16 requires the profile arg).
    revalidateTag(tag, 'max')
  }
  return NextResponse.json({ revalidated: true, tags })
}
