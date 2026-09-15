export const apiRoutePaths = [
  '/api/auth/telegram-guest',
  '/api/auth/telegram-signup',
  '/api/organizers',
  '/api/organizers/me',
  '/api/organizers/me/language',
  '/api/organizers/me/avatar',
  '/api/organizers/me/service-photo',
  '/api/services',
  '/api/services/:id',
  '/api/slots',
  '/api/slots/:id',
  '/api/bookings',
  '/api/bookings/lookup',
  '/api/bookings/cancel',
  '/api/bookings/cancel-by-organizer',
  '/api/jobs/:queue',
]

export function apiRewrites({ goApiUrl, production = false, appUrl }) {
  // In production, Go functions live in apps/web/api/ — Vercel's filesystem
  // routing serves them at /api/* automatically. No beforeFiles rewrites needed.
  if (production) {
    return { beforeFiles: [], afterFiles: [], fallback: [] }
  }

  // Dev: proxy /api/* to the local Go server (cmd/dev on :3001).
  const origin = new URL(goApiUrl || 'http://127.0.0.1:3001')
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
  if (appUrl && origin.origin === new URL(appUrl).origin) {
    throw new Error('GO_API_URL must differ from APP_URL to avoid a proxy loop')
  }

  return {
    beforeFiles: apiRoutePaths.map((source) => ({
      source,
      destination: `${origin.origin}${source}`,
    })),
    afterFiles: [],
    fallback: [],
  }
}
