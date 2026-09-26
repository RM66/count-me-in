/**
 * Phase 1 gate check (migration plan §1.2/§1.3/§1.4). Run from apps/web:
 *
 *   bun scripts/migration/check-inventory.ts
 *
 * Asserts the discovery documents in docs/migration/ are complete:
 *  1. endpoints.md has exactly one row per spec operation (+ healthz,
 *     marked in_spec=false) — the count is derived from openapi.yaml,
 *     never hardcoded.
 *  2. tests.md lists every runnable Go test. Source of truth is
 *     `go test -list '.*'` (231 at baseline; the grep finds 235 because
 *     it also catches TestMain and build-tagged helpers). Matching is
 *     word-boundary, so TestFoo does not satisfy TestFooBar.
 *  3. env.md lists every env var: both the call-site grep
 *     (os.Getenv("LITERAL")) and a literal scan of the files that read
 *     variables in loops (config.go, server.go, r2.go).
 *  4. Every scenario file has a golden transcript, and the coverage
 *     matrix in endpoints.md (operationId × error class → scenario#step
 *     with an expected status) is checked against the actual golden
 *     transcripts step by step.
 * Exits 0 when all assertions pass; prints a diff-style report otherwise.
 */
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Run from apps/web (documented usage): docs/ is a sibling of apps/.
const docsDir = join(process.cwd(), '..', '..', 'docs', 'migration')
const read = (name: string): string => readFileSync(join(docsDir, name), 'utf8')

let failures: string[] = []
const fail = (msg: string): void => {
  failures.push(msg)
}

// ── 1. endpoints.md vs openapi.yaml ─────────────────────────────────────────
const yaml = require('yaml')
const spec = yaml.parse(readFileSync('openapi.yaml', 'utf8'))
const methods = ['get', 'post', 'put', 'patch', 'delete'] as const
const specOps: { method: string; path: string; operationId: string }[] = []
for (const [path, item] of Object.entries(spec.paths ?? {})) {
  for (const m of methods) {
    const op = (item as Record<string, { operationId?: string }>)[m]
    if (op) specOps.push({ method: m.toUpperCase(), path, operationId: op.operationId ?? '?' })
  }
}

const endpoints = read('endpoints.md')
const rowOperationIds = new Set(
  endpoints
    .split('\n')
    .filter((l) => l.startsWith('| '))
    .map((l) => l.split('|')[2]?.trim() ?? '')
    .filter((id) => id && id !== 'Operation' && !id.startsWith('—')),
)
const healthzRow = /GET\s+\|\s+\/api\/healthz/.test(endpoints) && /in_spec:\s*false/.test(endpoints)

if (!healthzRow) fail('endpoints.md: no /api/healthz row with an explicit in_spec=false marker')
for (const op of specOps) {
  if (!rowOperationIds.has(op.operationId)) {
    fail(`endpoints.md: missing operation ${op.method} ${op.path} (${op.operationId})`)
  }
}
const specRowsFound = [...rowOperationIds].filter((id) =>
  specOps.some((o) => o.operationId === id),
).length
if (specRowsFound !== specOps.length) {
  fail(`endpoints.md: expected ${specOps.length} spec rows, found ${specRowsFound}`)
}
console.log(`endpoints.md: ${specOps.length} spec operations + healthz (in_spec=false)`)

// ── 2. tests.md vs runnable Go tests ────────────────────────────────────────
// `go test -list` is the source of truth: it excludes TestMain and
// anything behind build tags that the raw grep would count.
const goTests = execSync("go test -list '.*' ./pkg/... ./api/... 2>/dev/null", {
  shell: '/bin/zsh',
})
  .toString()
  .trim()
  .split('\n')
  .filter((l) => l.startsWith('Test'))

const tests = read('tests.md')
const missingTests = goTests.filter((t) => !new RegExp(`\\b${t}\\b`).test(tests))
if (missingTests.length > 0) {
  fail(`tests.md: missing ${missingTests.length} Go test(s): ${missingTests.join(', ')}`)
}
console.log(
  `tests.md: all ${goTests.length} runnable Go tests listed (go test -list; word-boundary match)`,
)

// ── 3. env.md vs env usage (call-site grep + loop-literal scan) ─────────────
const callSiteVars = [
  ...new Set(
    execSync(
      'grep -rhoE \'os\\.(Getenv|LookupEnv)\\("[A-Z_0-9]+"\' pkg api cmd 2>/dev/null || true',
      { shell: '/bin/zsh' },
    )
      .toString()
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => l.match(/"([A-Z_0-9]+)"/)?.[1] ?? '')
      .filter(Boolean),
  ),
]
// config.go, api/server.go and storage/r2.go read some variables in loops
// via os.Getenv(name) — the call-site grep misses them; scan for the
// uppercase literals in those files instead.
const loopVars = [
  ...new Set(
    execSync(
      'grep -hoE \'"[A-Z][A-Z0-9_]{2,}"\' pkg/config/config.go pkg/api/server.go pkg/storage/r2.go 2>/dev/null || true',
      { shell: '/bin/zsh' },
    )
      .toString()
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => l.replace(/"/g, '')),
  ),
]
const envVars = [...new Set([...callSiteVars, ...loopVars])]

const env = read('env.md')
const missingEnv = envVars.filter((v) => !env.includes(`\`${v}\``))
if (missingEnv.length > 0) {
  fail(`env.md: missing env var(s): ${missingEnv.join(', ')}`)
}
console.log(`env.md: all ${envVars.length} env vars listed (call-site + loop-literal scan)`)

// ── 4. golden coverage ─────────────────────────────────────────────────────
const scenarioFiles = execSync('ls tests_py/parity/scenarios/*.yaml', { shell: '/bin/zsh' })
  .toString()
  .trim()
  .split('\n')
  .filter(Boolean)
const goldenFiles = execSync('ls tests_py/parity/golden/*.json 2>/dev/null || true', {
  shell: '/bin/zsh',
})
  .toString()
  .trim()
  .split('\n')
  .filter(Boolean)

// Every step that creates or cancels a booking (POST /api/bookings,
// /api/bookings/cancel, /api/bookings/cancel-by-organizer) MUST declare
// expectSink — without it the recorder stops waiting at the first sink
// call and a two-call fan-out (booking.created → organizer + guest)
// would silently record one.
const BOOKING_PATHS = new Set([
  '/api/bookings',
  '/api/bookings/cancel',
  '/api/bookings/cancel-by-organizer',
])
for (const scenario of scenarioFiles) {
  const parsed = yaml.parse(readFileSync(scenario, 'utf8'))
  for (const [i, step] of (parsed.steps ?? []).entries()) {
    const path = step?.request?.path
    if (path && BOOKING_PATHS.has(path) && step.expectSink === undefined) {
      fail(`scenarios: ${scenario} step ${i + 1} (${path}) must declare expectSink`)
    }
  }
}

for (const scenario of scenarioFiles) {
  const golden = scenario.replace('/scenarios/', '/golden/').replace(/\.yaml$/, '.json')
  if (!existsSync(golden)) fail(`golden: missing transcript for scenario ${scenario}`)
}

// Per-step golden invariants: content-length must match the raw body
// byte count (recorded as a fact — the raw number floats with
// RFC3339Nano trailing-zero trimming), chunked encoding must be absent,
// and any Retry-After must sit inside its rate-limit window.
for (const goldenFile of goldenFiles) {
  const golden = JSON.parse(readFileSync(goldenFile, 'utf8'))
  for (const [i, step] of (golden.steps ?? []).entries()) {
    const resp = step.response
    if (!resp) continue
    if (resp.contentLengthMatchesBody !== true) {
      fail(`golden: ${goldenFile} step ${i + 1}: content-length does not match body_raw length`)
    }
    if (resp.transferEncodingChunked !== false) {
      fail(`golden: ${goldenFile} step ${i + 1}: response must not be chunked`)
    }
    if (resp.retryAfterWithinWindow === false) {
      fail(`golden: ${goldenFile} step ${i + 1}: Retry-After outside its rate-limit window`)
    }
  }
}
console.log(
  `golden: content-length/chunked/Retry-After facts checked on ${goldenFiles.length} transcripts`,
)

// Coverage matrix: rows of the form
//   | <operationId> | <error class> | <scenario>.yaml#<step> | <expected status> |
// The step index is 1-based into the scenario's recorded steps; the
// golden transcript at that step must answer the expected status.
// Column padding (table alignment) is tolerated.
const matrixRows = [
  ...endpoints.matchAll(
    /^\s*\| *([a-zA-Z]+) *\| *([^|]+?) *\| *(\S+\.yaml)#(\d+) *\| *(\d{3}) *\|\s*$/gm,
  ),
]
let checked = 0
for (const m of matrixRows) {
  const operationId = m[1] ?? '?'
  const klass = (m[2] ?? '?').trim()
  const ref = m[3] ?? '?'
  const stepIdx = m[4] ?? '?'
  const status = m[5] ?? '?'
  const goldenPath = join('tests_py', 'parity', 'golden', ref.replace(/\.yaml$/, '.json'))
  if (!existsSync(goldenPath)) {
    fail(`golden: matrix row ${operationId} × ${klass} points at missing ${ref}`)
    continue
  }
  const golden = JSON.parse(readFileSync(goldenPath, 'utf8'))
  const step = golden.steps?.[Number(stepIdx) - 1]
  if (!step) {
    fail(`golden: ${ref} has no step #${stepIdx} (for ${operationId} × ${klass})`)
    continue
  }
  if (step.response.status !== Number(status)) {
    fail(
      `golden: ${ref}#${stepIdx} (${operationId} × ${klass}) expected ${status}, ` +
        `recorded ${step.response.status}`,
    )
  }
  checked++
}
if (checked === 0) fail('golden: coverage matrix in endpoints.md has no checkable rows')
console.log(
  `golden: ${scenarioFiles.length} scenarios, ${goldenFiles.length} transcripts, ${checked} matrix rows verified`,
)

// ── Result ──────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error(`\ncheck-inventory FAILED (${failures.length}):`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('\ncheck-inventory OK')
