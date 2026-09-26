/**
 * Mini-generator for `pkg/contracts/constants_gen.go` (ADR-016, Phase 5)
 * and `api/_lib/countmein/contracts/constants_gen.py` (ADR-021) —
 * the only codegen remnant after the migration to standard OpenAPI tooling.
 *
 * The API needs a handful of plain constants that live in
 * `@repo/contracts` (queue names, the demo organizer id, login-link key
 * prefix, locales, …). They are not expressible in the OpenAPI document,
 * so they are rendered from the TS source of truth by this script —
 * the writers and the TS reader cannot drift.
 *
 * Run via: `bun run generate:constants`
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEMO_ORGANIZER_ID,
  DEMO_ORGANIZER_SLUG,
  DEMO_READ_ONLY_CODE,
  DEMO_READ_ONLY_MESSAGE,
  DEMO_SERVICE_IDS,
} from '@repo/contracts'
import { LOGIN_LINK_KEY_PREFIX, LOGIN_LINK_TTL_S } from '@repo/contracts'
import { DEFAULT_LOCALE, LOCALES, SESSION_COOKIE_NAMES } from '@repo/contracts'
import {
  QUEUE_BOOKING_CANCELLED,
  QUEUE_BOOKING_CREATED,
  QUEUE_DEMO_REFRESH,
  QUEUE_OUTBOX_SWEEP,
} from '@repo/contracts'
import { SLOT_START_IN_PAST_MESSAGE, SLOT_START_TOLERANCE_MS } from '@repo/contracts'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const goOutFile = join(__dirname, '..', 'pkg', 'contracts', 'constants_gen.go')
const pyOutFile = join(__dirname, '..', 'api', '_lib', 'countmein', 'contracts', 'constants_gen.py')

function goString(value: string): string {
  return JSON.stringify(value)
}

function goStringSlice(values: readonly string[]): string {
  return `{${values.map((v) => goString(v)).join(', ')}}`
}

/** JSON string escaping is a valid Python double-quoted literal for these values. */
function pyString(value: string): string {
  return JSON.stringify(value)
}

function pyStringList(values: readonly string[]): string {
  return `[${values.map((v) => pyString(v)).join(', ')}]`
}

const content = `// Generated from packages/contracts via scripts/generate-constants.ts
// (ADR-016, Phase 5). Contains only derived constants; hand-written code
// lives in domain.go / flex.go. Regenerate with: bun run generate:constants
package contracts

// Demo account (ADR-010).
const (
	DemoOrganizerID       = ${goString(DEMO_ORGANIZER_ID)}
	DemoOrganizerSlug     = ${goString(DEMO_ORGANIZER_SLUG)}
	DemoReadOnlyCode      = ${goString(DEMO_READ_ONLY_CODE)}
	DemoReadOnlyMessage   = ${goString(DEMO_READ_ONLY_MESSAGE)}
	DemoServiceYoga       = ${goString(DEMO_SERVICE_IDS.yoga)}
	DemoServicePottery    = ${goString(DEMO_SERVICE_IDS.pottery)}
	DemoServiceBreathwork = ${goString(DEMO_SERVICE_IDS.breathwork)}
)

// QStash queues (ADR-012).
const (
	QueueBookingCreated   = ${goString(QUEUE_BOOKING_CREATED)}
	QueueBookingCancelled = ${goString(QUEUE_BOOKING_CANCELLED)}
	QueueDemoRefresh      = ${goString(QUEUE_DEMO_REFRESH)}
	QueueOutboxSweep      = ${goString(QUEUE_OUTBOX_SWEEP)}
)

// One-time login links. The prefix is generated from the TS constant, so the
// Go writer and the TS reader cannot disagree on the Redis key.
const (
	LoginLinkTTLSeconds = ${String(LOGIN_LINK_TTL_S)}
	LoginLinkKeyPrefix  = ${goString(LOGIN_LINK_KEY_PREFIX)}
)

// Slot validation tolerance.
const (
	SlotStartToleranceMS   = ${String(SLOT_START_TOLERANCE_MS)}
	SlotStartInPastMessage = ${goString(SLOT_START_IN_PAST_MESSAGE)}
)

// Locales — language switcher order (ADR-011).
var Locales = []string${goStringSlice(LOCALES)}

const DefaultLocale = ${goString(DEFAULT_LOCALE)}

// Auth.js session cookie names, https ("__Secure-"-prefixed, prod) first.
var SessionCookieNames = []string${goStringSlice(SESSION_COOKIE_NAMES)}
`

writeFileSync(goOutFile, content, 'utf8')
console.log(`Wrote ${goOutFile}`)

// Python target (ADR-021). Names mirror the Go constants in SCREAMING_SNAKE;
// hand-written code lives in domain.py / payloads.py.
const pyContent = `# Generated from packages/contracts via scripts/generate-constants.ts
# (ADR-021). Contains only derived constants; hand-written code lives in
# domain.py / payloads.py. Regenerate with: bun run generate:constants

# Demo account (ADR-010).
DEMO_ORGANIZER_ID = ${pyString(DEMO_ORGANIZER_ID)}
DEMO_ORGANIZER_SLUG = ${pyString(DEMO_ORGANIZER_SLUG)}
DEMO_READ_ONLY_CODE = ${pyString(DEMO_READ_ONLY_CODE)}
DEMO_READ_ONLY_MESSAGE = ${pyString(DEMO_READ_ONLY_MESSAGE)}
DEMO_SERVICE_YOGA = ${pyString(DEMO_SERVICE_IDS.yoga)}
DEMO_SERVICE_POTTERY = ${pyString(DEMO_SERVICE_IDS.pottery)}
DEMO_SERVICE_BREATHWORK = ${pyString(DEMO_SERVICE_IDS.breathwork)}

# QStash queues (ADR-012).
QUEUE_BOOKING_CREATED = ${pyString(QUEUE_BOOKING_CREATED)}
QUEUE_BOOKING_CANCELLED = ${pyString(QUEUE_BOOKING_CANCELLED)}
QUEUE_DEMO_REFRESH = ${pyString(QUEUE_DEMO_REFRESH)}
QUEUE_OUTBOX_SWEEP = ${pyString(QUEUE_OUTBOX_SWEEP)}

# One-time login links. The prefix is generated from the TS constant, so the
# Python writer and the TS reader cannot disagree on the Redis key.
LOGIN_LINK_TTL_SECONDS = ${String(LOGIN_LINK_TTL_S)}
LOGIN_LINK_KEY_PREFIX = ${pyString(LOGIN_LINK_KEY_PREFIX)}

# Slot validation tolerance.
SLOT_START_TOLERANCE_MS = ${String(SLOT_START_TOLERANCE_MS)}
SLOT_START_IN_PAST_MESSAGE = ${pyString(SLOT_START_IN_PAST_MESSAGE)}

# Locales — language switcher order (ADR-011).
LOCALES = ${pyStringList(LOCALES)}

DEFAULT_LOCALE = ${pyString(DEFAULT_LOCALE)}

# Auth.js session cookie names, https ("__Secure-"-prefixed, prod) first.
SESSION_COOKIE_NAMES = ${pyStringList(SESSION_COOKIE_NAMES)}
`

writeFileSync(pyOutFile, pyContent, 'utf8')
console.log(`Wrote ${pyOutFile}`)
