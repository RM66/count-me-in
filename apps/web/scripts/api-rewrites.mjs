export const apiRoutePaths = [
  '/api/auth/telegram-guest',
  '/api/auth/telegram-signup',
  '/api/organizers',
  '/api/organizers/me',
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
  if (production && !goApiUrl) {
    throw new Error('GO_API_URL is required: deploy the Go API before building web')
  }
  const origin = new URL(goApiUrl || 'http://127.0.0.1:3001')
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    (production && origin.protocol !== 'https:') ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== '/'
  ) {
    throw new Error(
      'GO_API_URL must be an origin without credentials, path, query or fragment (HTTPS in production)',
    )
  }
  if (appUrl && origin.origin === new URL(appUrl).origin) {
    throw new Error('GO_API_URL must differ from APP_URL to avoid a proxy loop')
  }
  // Explicit routes keep every Auth.js endpoint on Next.js.
  return {
    beforeFiles: apiRoutePaths.map((source) => ({
      source,
      destination: `${origin.origin}${source}`,
    })),
    afterFiles: [],
    fallback: [],
  }
}
