import { defineConfig } from 'drizzle-kit'

// drizzle-kit uses the `pg` driver, which parses `sslmode=require` from the
// connection string into `ssl: { rejectUnauthorized: true }` (verify-full) and
// fails the SSL handshake on hosted Postgres (Vercel/Neon) without a CA cert.
// Strip `sslmode` from the URL so the `ssl` option below actually applies.
// The app itself connects via postgres-js (packages/db/src/client.ts), which
// is unaffected by this dev-only config.
function stripSslMode(url: string): string {
  const [base, query] = url.split('?')
  if (!query) return url
  const params = query.split('&').filter((p) => !p.startsWith('sslmode='))
  return params.length > 0 ? `${base}?${params.join('&')}` : (base ?? '')
}

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: stripSslMode(
      process.env.POSTGRES_URL ?? 'postgresql://countmein:countmein@localhost:5432/countmein',
    ),
    ssl: { rejectUnauthorized: false },
  },
})
