/**
 * Verify vercel.json rewrites cover every Go API route registered in
 * pkg/routes/mux.go, and that apps/web/openapi.yaml documents the same
 * operations as the route manifest. vercel.json is the single source of
 * truth for API routing (production edge rewrites + dev proxy). Auth.js
 * (/api/auth/[...nextauth]) stays on Next.js — deliberately omitted from
 * vercel.json so Next.js handles it.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { API_ROUTES } from '@repo/contracts/routes'
import yaml from 'yaml'

const webDir = join(fileURLToPath(import.meta.url), '..', '..')
const muxFile = join(webDir, 'pkg', 'routes', 'mux.go')
const vercelFile = join(webDir, 'vercel.json')
const openapiFile = join(webDir, 'openapi.yaml')

const muxContent = readFileSync(muxFile, 'utf8')
const vercelConfig = JSON.parse(readFileSync(vercelFile, 'utf8')) as {
  rewrites?: Array<{ source: string; destination: string }>
}

// Extract every mux.HandleFunc("/api/...", ...) pattern.
const goRoutes = [...muxContent.matchAll(/mux\.HandleFunc\("([^"]+)"/g)]
  .map((m) => m[1])
  .filter((p): p is string => typeof p === 'string')
  .sort()

const rewriteRules = (vercelConfig.rewrites ?? []).map((r) => r.source)

function patternToRegex(source: string): RegExp {
  const pattern = source
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\/:[a-zA-Z0-9_]+\*/g, '(?:/.*)?')
    .replace(/:[a-zA-Z0-9_]+\*/g, '.*')
    .replace(/:[a-zA-Z0-9_]+/g, '[^/]+')
  return new RegExp(`^${pattern}$`)
}

const ruleRegexes = rewriteRules.map((r) => ({
  source: r,
  regex: patternToRegex(r),
}))

// 1. Every Go route in mux.go must match at least one rewrite rule in vercel.json
const uncoveredRoutes = goRoutes.filter(
  (route) => !ruleRegexes.some((rule) => rule.regex.test(route)),
)

// 2. Every rewrite rule in vercel.json must match at least one route in mux.go
const unusedRules = ruleRegexes
  .filter((rule) => !goRoutes.some((route) => rule.regex.test(route)))
  .map((rule) => rule.source)

let failed = false

if (uncoveredRoutes.length === 0 && unusedRules.length === 0) {
  console.log(
    `vercel.json rewrites in sync with Go mux routes (${goRoutes.length} routes covered by ${rewriteRules.length} rules)`,
  )
} else {
  failed = true
  console.error('vercel.json rewrites are out of sync with Go mux.go:')
  if (uncoveredRoutes.length > 0) {
    console.error('\n  Routes in Go mux.go not covered by vercel.json:')
    for (const r of uncoveredRoutes) console.error(`    + ${r}`)
  }
  if (unusedRules.length > 0) {
    console.error('\n  Rewrite rules in vercel.json matching no Go routes:')
    for (const r of unusedRules) console.error(`    - ${r}`)
  }
  console.error('\nFix: update rewrites in apps/web/vercel.json or routes in pkg/routes/mux.go')
}

// 3. Method-level OpenAPI ↔ manifest parity. Mux ↔ manifest lives in
// pkg/routes/manifest_test.go; this check owns spec ↔ manifest and
// vercel.json ↔ mux.
const openapiDoc = yaml.parse(readFileSync(openapiFile, 'utf8')) as {
  paths?: Record<string, Record<string, unknown>>
}
const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete'])
const specOperations = new Set(
  Object.entries(openapiDoc.paths ?? {}).flatMap(([path, item]) =>
    Object.keys(item)
      .filter((m) => METHODS.has(m))
      .map((m) => `${m.toUpperCase()} ${path}`),
  ),
)
const manifestOperations = new Set(
  API_ROUTES.map((r) => `${r.method.toUpperCase()} ${r.path}`),
)

const missingInOpenapi = [...manifestOperations].filter((op) => !specOperations.has(op))
const extraInOpenapi = [...specOperations].filter((op) => !manifestOperations.has(op))

if (missingInOpenapi.length === 0 && extraInOpenapi.length === 0) {
  console.log(`openapi.yaml operations in sync with the route manifest (${specOperations.size} operations)`)
} else {
  failed = true
  console.error('openapi.yaml operations are out of sync with the route manifest:')
  for (const r of missingInOpenapi) console.error(`    + missing in openapi: ${r}`)
  for (const r of extraInOpenapi) console.error(`    - extra in openapi: ${r}`)
  console.error('\nFix: regenerate via `bun run generate:contracts` or update packages/contracts/src/routes.ts')
}

process.exit(failed ? 1 : 0)
