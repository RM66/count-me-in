/**
 * Mini-generator for `api/_lib/countmein/contracts/constants_gen.py`
 * (ADR-021) — the only codegen remnant after the migration to standard
 * OpenAPI tooling.
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
  ORGANIZER_AUTH_AUD,
  ORGANIZER_AUTH_ISS,
} from '@repo/contracts'
import { LOGIN_LINK_KEY_PREFIX, LOGIN_LINK_TTL_S } from '@repo/contracts'
import { DEFAULT_LOCALE, LOCALES } from '@repo/contracts'
import {
  QUEUE_BOOKING_CANCELLED,
  QUEUE_BOOKING_CREATED,
  QUEUE_DEMO_REFRESH,
  QUEUE_OUTBOX_SWEEP,
} from '@repo/contracts'
import { SLOT_START_IN_PAST_MESSAGE, SLOT_START_TOLERANCE_MS } from '@repo/contracts'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const pyOutFile = join(__dirname, '..', 'api', '_lib', 'countmein', 'contracts', 'constants_gen.py')

/** JSON string escaping is a valid Python double-quoted literal for these values. */
function pyString(value: string): string {
  return JSON.stringify(value)
}

function pyStringList(values: readonly string[]): string {
  return `[${values.map((v) => pyString(v)).join(', ')}]`
}

// Python target (ADR-021). Names are SCREAMING_SNAKE;
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

# Organizer-auth JWT audience binding (ADR-024): the middleware mints
# iss/aud, the API requires them — generated so the two sides cannot drift.
ORGANIZER_AUTH_ISS = ${pyString(ORGANIZER_AUTH_ISS)}
ORGANIZER_AUTH_AUD = ${pyString(ORGANIZER_AUTH_AUD)}

# Slot validation tolerance.
SLOT_START_TOLERANCE_MS = ${String(SLOT_START_TOLERANCE_MS)}
SLOT_START_IN_PAST_MESSAGE = ${pyString(SLOT_START_IN_PAST_MESSAGE)}

# Locales — language switcher order (ADR-011).
LOCALES = ${pyStringList(LOCALES)}

DEFAULT_LOCALE = ${pyString(DEFAULT_LOCALE)}
`

writeFileSync(pyOutFile, pyContent, 'utf8')
console.log(`Wrote ${pyOutFile}`)
