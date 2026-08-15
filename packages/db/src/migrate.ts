import { existsSync, readFileSync } from 'node:fs'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

// Local dev: load the repo-root .env (bun doesn't walk up from packages/db).
// CI sets POSTGRES_URL directly as an env var, so a missing .env is fine.
// Must run before importing ./client, which reads POSTGRES_URL at module load.
const envPath = '../../.env'
if (existsSync(envPath)) {
  const envRe = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = envRe.exec(line)
    if (match && match[1] !== undefined) {
      const key = match[1]
      // Strip surrounding single/double quotes (bun --env-file does this too),
      // so a quoted value like POSTGRES_URL="postgres://..." parses correctly.
      const value = (match[2] ?? '').replace(/^(['"])(.*)\1$/, '$2')
      if (!(key in process.env)) {
        process.env[key] = value
      }
    }
  }
}

const { client, db } = await import('./client')

/**
 * Apply Drizzle migrations using the same postgres-js driver as the app
 * (packages/db/src/client.ts). Running `drizzle-kit migrate` instead would use
 * the `pg` driver, which treats sslmode=require as verify-full and fails the
 * SSL handshake on hosted Postgres (Vercel/Neon) without a CA cert. It also
 * hides the real Postgres error behind a spinner. This script surfaces it.
 */
async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder: './drizzle' })
  console.log('[migrate] migrations applied')
}

if (import.meta.main) {
  try {
    await runMigrations()
  } catch (error) {
    console.error('[migrate] failed to apply migrations:', error)
    process.exitCode = 1
  } finally {
    await client.end()
  }
}
