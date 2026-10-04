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
/**
 * Vercel Deployment Protection bypass for server-side fetches.
 *
 * When a preview deployment is gated (Vercel Authentication / Standard
 * Protection), browser requests pass on the user's bypass cookie, but a
 * server-side fetch carries no cookies: the edge redirects it to the
 * SSO login page, fetch follows the redirect, and the API read comes
 * back `200 text/html` — which surfaces as a Zod "contract violation".
 *
 * `VERCEL_AUTOMATION_BYPASS_SECRET` is injected by Vercel once
 * "Protection Bypass for Automation" is enabled in project settings;
 * elsewhere the var is absent and no header is sent. Like
 * `x-internal-secret`, the header goes only to the configured API
 * origin — never to a request-derived host.
 */
export function deploymentBypassHeaders(): Record<string, string> {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  return secret ? { 'x-vercel-protection-bypass': secret } : {}
}

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
