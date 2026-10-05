import { cookies } from 'next/headers'
import { unstable_rethrow } from 'next/navigation'

import 'server-only'

/**
 * Normalize a configured origin. Vercel system variables carry a bare host,
 * so a missing scheme means https. Anything beyond scheme + host + port
 * (credentials, path, query, fragment) is refused rather than silently
 * dropped: a typo must not steer credentialed fetches somewhere unexpected.
 */
function toOrigin(name: string, raw: string | undefined): string | undefined {
  const value = raw?.trim()
  if (!value) {
    return undefined
  }
  const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
  if (url.href !== `${url.origin}/`) {
    throw new Error(`${name} must be an origin without credentials, path, query or fragment`)
  }
  return url.origin
}

/**
 * Resolve the API origin for a server-side fetch.
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
 * 2. On Vercel, the deployment's environment decides:
 *    - production: `VERCEL_PROJECT_PRODUCTION_URL` — the production domain,
 *      which Standard Deployment Protection leaves ungated. The deployment
 *      URL (`VERCEL_URL`) is gated, and a fetch without the bypass would be
 *      redirected to the SSO page and parse its HTML as a broken JSON body.
 *      Trade-off: the production domain serves the *promoted* deployment,
 *      so a non-promoted production build (e.g. after an Instant Rollback)
 *      reads the promoted deployment's API.
 *    - preview: `VERCEL_URL` — the deployment's own host, so the preview
 *      talks to its own API; `deploymentBypassHeaders` covers the gate.
 *      Never the production domain: preview credentials stay off prod.
 * 3. `NEXT_PUBLIC_SITE_URL` — the configured public origin.
 *
 * In production, none configured is a misconfiguration — fail closed
 * rather than guess an origin to send credentials to. In dev, fall back
 * to the local API default port.
 */
export async function resolveApiOrigin(): Promise<string> {
  const vercelOrigin =
    process.env.VERCEL_ENV === 'production'
      ? toOrigin('VERCEL_PROJECT_PRODUCTION_URL', process.env.VERCEL_PROJECT_PRODUCTION_URL)
      : toOrigin('VERCEL_URL', process.env.VERCEL_URL)
  const origin =
    toOrigin('API_URL', process.env.API_URL) ??
    vercelOrigin ??
    toOrigin('NEXT_PUBLIC_SITE_URL', process.env.NEXT_PUBLIC_SITE_URL)
  if (origin) {
    return origin
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Cannot resolve the API origin: set API_URL or NEXT_PUBLIC_SITE_URL ' +
        '(VERCEL_URL / VERCEL_PROJECT_PRODUCTION_URL are provided automatically on Vercel)',
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
 *    injected by Vercel at build time once "Protection Bypass for
 *    Automation" is on in project settings; also covers non-request
 *    fetches (ISR, callbacks). Rotating the secret requires a redeploy.
 * 2. The viewer's own `_vercel_jwt` cookie, forwarded — anyone who can
 *    open a gated preview already carries it, so request-scoped reads
 *    pass even without the project secret.
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
  } catch (error) {
    // Next's own control flow (dynamic-usage bail-out during prerender)
    // must propagate; only a genuine absence of request scope is absorbed.
    unstable_rethrow(error)
    return {}
  }
}
