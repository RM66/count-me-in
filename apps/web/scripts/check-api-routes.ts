/**
 * Verify api-rewrites.mjs paths match the Go API handlers under apps/web/api/.
 * One directory per route; each index.go is a Vercel function. Directory → URL:
 *   api/bookings/index.go          → /api/bookings
 *   api/services/by-id/index.go    → /api/services/:id (vercel.json rewrite)
 * Auth.js (/api/auth/[...nextauth]) stays on Next.js — not in the rewrite list.
 */
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { apiRoutePaths } from './api-rewrites.mjs'

const goApiDir = join(fileURLToPath(import.meta.url), '..', '..', 'api')

// Vercel Go functions cannot use bracket directories ([id], [queue]) —
// go mod tidy rejects '[' in import paths. Dynamic route dirs use plain
// names (by-id, by-queue) and vercel.json rewrites map :id / :queue to
// them. This table restores the :param shape for the dev-mode rewrite
// list so it matches the URL contract.
const dynamicSegmentMap: Record<string, string> = {
  'by-id': ':id',
  'by-queue': ':queue',
}

function collectGoRoutes(dir: string, prefix = ''): string[] {
  const routes: string[] = []
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    if (statSync(fullPath).isDirectory()) {
      const segment = dynamicSegmentMap[entry] ?? entry
      const path = prefix ? `${prefix}/${segment}` : `/${segment}`
      try {
        statSync(join(fullPath, 'index.go'))
        routes.push(path)
      } catch {
        // No index.go here — keep descending for nested routes.
      }
      routes.push(...collectGoRoutes(fullPath, path))
    }
  }
  return routes
}

const goRoutes = collectGoRoutes(goApiDir)
  .map((r) => `/api${r}`)
  .sort()
const rewritePaths = [...apiRoutePaths].sort()

const missing = goRoutes.filter((r) => !rewritePaths.includes(r))
const extra = rewritePaths.filter((r) => !goRoutes.includes(r))

if (missing.length === 0 && extra.length === 0) {
  console.log(`api-rewrites.mjs in sync with Go API routes (${goRoutes.length} routes)`)
  process.exit(0)
}

console.error('api-rewrites.mjs is out of sync with Go API routes:')
if (missing.length > 0) {
  console.error('\n  Routes in Go API but missing from api-rewrites.mjs:')
  for (const r of missing) console.error(`    + ${r}`)
}
if (extra.length > 0) {
  console.error('\n  Routes in api-rewrites.mjs but no Go handler exists:')
  for (const r of extra) console.error(`    - ${r}`)
}
console.error('\nFix: update the apiRoutePaths array in apps/web/scripts/api-rewrites.mjs')
process.exit(1)
