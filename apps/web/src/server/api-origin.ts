import { cookies } from 'next/headers'

import 'server-only'

function trimSlash(value: string | undefined): string | undefined {
  return value?.replace(/\/$/, '') || undefined
}

/**
 * Resolve the API origin for a server-side fetch (ADR-022).
 *
 * Kept in its own leaf module so both `api.ts` (session-minting writes)
 * and `internal-api.ts` (Auth.js provider lookup) share one origin
 * without forming an import cycle through `auth()`.
 *
 * The origin comes only from *configuration*, never from the incoming
 * request's `Host`/`X-Forwarded-*` headers: a server fetch carries the
 * `x-internal-secret` (and the organizer JWT), and off-Vercel topologies
 * let a client spoof Host — which would exfiltrate the secret to the
 * attacker's origin.
 *
 * Resolution order:
 * 1. `API_URL` — a separate API origin (dev API server, container twin).
 * 2. `VERCEL_URL` — the deployment's own host; the Python API is reached
 *    through the same-origin rewrite on every Vercel deployment.
 * 3. `VERCEL_PROJECT_PRODUCTION_URL` — present even when VERCEL_URL is not
 *    (e.g. `vercel dev` serving production traffic locally).
 * 4. `NEXT_PUBLIC_SITE_URL` — the configured public origin.
 *
 * In production, none configured is a misconfiguration — fail closed
 * rather than guess an origin to send credentials to. In dev, fall back
 * to the local API default port.
 */
export async function resolveApiOrigin(): Promise<string> {
  const apiUrl = trimSlash(process.env.API_URL)
  if (apiUrl) {
    return apiUrl
  }
  const vercelHost = process.env.VERCEL_URL ?? process.env.VERCEL_PROJECT_PRODUCTION_URL
  if (vercelHost) {
    return `https://${vercelHost.replace(/^https?:\/\//, '').replace(/\/$/, '')}`
  }
  const siteUrl = trimSlash(process.env.NEXT_PUBLIC_SITE_URL)
  if (siteUrl) {
    return siteUrl
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Cannot resolve the API origin: set API_URL or NEXT_PUBLIC_SITE_URL ' +
        '(VERCEL_URL is provided automatically on Vercel)',
    )
  }
  return 'http://127.0.0.1:3001'
}

const VERCEL_BYPASS_COOKIE = '_vercel_jwt'

/**
 * Vercel Deployment Protection bypass for server-side fetches.
 *
 * When a preview deployment is gated (Vercel Authentication / Standard
 * Protection), browser requests pass on the user's bypass cookie, but a
 * server-side fetch carries no cookies: the edge redirects it to the
 * SSO login page, fetch follows the redirect, and the API read comes
 * back `200 text/html` — which surfaces as a Zod "contract violation".
 *
 * Two credentials, in order:
 * 1. `VERCEL_AUTOMATION_BYPASS_SECRET` as `x-vercel-protection-bypass` —
 *    injected by Vercel once "Protection Bypass for Automation" is on in
 *    project settings; also covers non-request fetches (ISR, callbacks).
 * 2. The viewer's own `_vercel_jwt` cookie, forwarded — anyone who can
 *    open a gated preview already carries it, so request-scoped reads
 *    pass without any project configuration.
 *
 * The cookie path is preview-only: production and unprotected previews
 * need no bypass, and reading request cookies in production would
 * needlessly mark public reads dynamic. Like `x-internal-secret`, both
 * go only to the configured API origin — never to a request-derived
 * host.
 */
export async function deploymentBypassHeaders(): Promise<Record<string, string>> {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  if (secret) {
    return { 'x-vercel-protection-bypass': secret }
  }
  if (process.env.VERCEL_ENV !== 'preview') {
    return {}
  }
  try {
    const jwt = (await cookies()).get(VERCEL_BYPASS_COOKIE)?.value
    return jwt ? { cookie: `${VERCEL_BYPASS_COOKIE}=${jwt}` } : {}
  } catch {
    // No request scope (build-time prerender, ISR revalidation): nothing to forward.
    return {}
  }
}
