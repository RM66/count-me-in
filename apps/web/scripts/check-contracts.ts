/**
 * Verify shared constants between the TS contracts (`packages/contracts`)
 * and the Go contracts (`apps/web/internal/contracts`) are in sync.
 *
 * The two sides are hand-mirrored — there is no code generation — so a
 * constant edited on one side can silently diverge from the other. This
 * script extracts the values that must agree and fails CI when they don't.
 *
 * What is checked:
 *   - Locales array + default locale
 *   - Demo organizer id, slug, service ids, read-only code/message
 *   - QStash queue names + demo refresh cron
 *   - Enum values (booking status, messenger, options select mode,
 *     notification recipient, cancel actor)
 *   - Login link TTL + key prefix
 *
 * The Go side is parsed with regex against the source files (not imported):
 * the Go module is not a TS dependency, and running `go run` for every
 * constant would be slow and fragile. The regexes are deliberately tight
 * — they match the exact declaration patterns used in the codebase.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  bookingStatusEnum,
  cancelActorEnum,
  DEFAULT_LOCALE,
  DEMO_ORGANIZER_ID,
  DEMO_ORGANIZER_SLUG,
  DEMO_READ_ONLY_CODE,
  DEMO_READ_ONLY_MESSAGE,
  DEMO_REFRESH_CRON,
  DEMO_SERVICE_IDS,
  LOCALES,
  LOGIN_LINK_TTL_S,
  loginLinkKey,
  messengerEnum,
  notificationRecipientEnum,
  optionsSelectModeEnum,
  QUEUE_BOOKING_CANCELLED,
  QUEUE_BOOKING_CREATED,
  QUEUE_DEMO_REFRESH,
} from '@repo/contracts'

// ── Go source extraction ────────────────────────────────────────────────────

const scriptsDir = fileURLToPath(import.meta.url)
const webDir = join(scriptsDir, '..', '..')
const goContractsDir = join(webDir, 'internal', 'contracts')

function readGo(name: string): string {
  return readFileSync(join(goContractsDir, name), 'utf8')
}

/** Extract a Go string constant: `const Name = "value"` or `Name Type = "value"`. */
function goString(source: string, name: string): string {
  const re = new RegExp(`\\b${name}\\b[^\\n=]*=\\s*"([^"]*)"`)
  const m = source.match(re)
  if (!m || m[1] === undefined) throw new Error(`Go constant ${name} not found`)
  return m[1]
}

/** Extract a Go int constant: `const Name = <expr>` (supports `a * b * c * …`). */
function goInt(source: string, name: string): number {
  const re = new RegExp(`\\b${name}\\b[^\\n=]*=\\s*([0-9]+(?:\\s*\\*\\s*[0-9]+)*)`)
  const m = source.match(re)
  if (!m || m[1] === undefined) throw new Error(`Go int constant ${name} not found`)
  return evalArithmetic(m[1])
}

function evalArithmetic(expr: string): number {
  const parts = expr.split('*').map((p) => parseInt(p.trim(), 10))
  return parts.reduce((a, b) => a * b, 1)
}

/** Extract a Go string slice literal: `[]string{"a", "b", ...}`. */
function goStringSlice(source: string, name: string): string[] {
  const re = new RegExp(`\\b${name}\\s*=\\s*\\[\\]string\\{([^}]*)\\}`)
  const m = source.match(re)
  if (!m || m[1] === undefined) throw new Error(`Go slice ${name} not found`)
  return m[1]
    .split(',')
    .map((s) => s.trim().match(/"([^"]*)"/)?.[1] ?? '')
    .filter(Boolean)
}

/** Extract a Go function body returning a string: `func Name(args) string { ... }`. */
function goFuncString(source: string, name: string): string {
  const re = new RegExp(`func ${name}\\([^)]*\\)\\s*string\\s*\\{[^}]*?"([^"]*)"[^}]*?\\}`)
  const m = source.match(re)
  if (!m || m[1] === undefined) throw new Error(`Go function ${name} not found`)
  return m[1]
}

// ── TS contract values ──────────────────────────────────────────────────────

// These are imported from @repo/contracts at the top of the file.
// The values below are the TS source of truth; the Go side must match.

// ── Comparison ───────────────────────────────────────────────────────────────

type Mismatch = { name: string; ts: string; go: string }

const mismatches: Mismatch[] = []

function check(name: string, ts: unknown, go: unknown): void {
  const tsStr = JSON.stringify(ts)
  const goStr = JSON.stringify(go)
  if (tsStr !== goStr) {
    mismatches.push({ name, ts: tsStr, go: goStr })
  }
}

// ── enums.go ─────────────────────────────────────────────────────────────────

const enumsGo = readGo('enums.go')

check('LOCALES', LOCALES, goStringSlice(enumsGo, 'Locales'))
check('DEFAULT_LOCALE', DEFAULT_LOCALE, goString(enumsGo, 'DefaultLocale'))

// BookingStatus: TS Zod enum options vs Go consts
check('BOOKING_STATUS_VALUES', bookingStatusEnum.options, [
  goString(enumsGo, 'BookingConfirmed'),
  goString(enumsGo, 'BookingCancelled'),
])

// Messenger
check('MESSENGER_VALUES', messengerEnum.options, [goString(enumsGo, 'MessengerTelegram')])

// OptionsSelectMode
check('OPTIONS_SELECT_MODE_VALUES', optionsSelectModeEnum.options, [
  goString(enumsGo, 'OptionsSingle'),
  goString(enumsGo, 'OptionsMulti'),
])

// ── demo.go ─────────────────────────────────────────────────────────────────

const demoGo = readGo('demo.go')

check('DEMO_ORGANIZER_ID', DEMO_ORGANIZER_ID, goString(demoGo, 'DemoOrganizerID'))
check('DEMO_ORGANIZER_SLUG', DEMO_ORGANIZER_SLUG, goString(demoGo, 'DemoOrganizerSlug'))
check('DEMO_READ_ONLY_CODE', DEMO_READ_ONLY_CODE, goString(demoGo, 'DemoReadOnlyCode'))
check('DEMO_READ_ONLY_MESSAGE', DEMO_READ_ONLY_MESSAGE, goString(demoGo, 'DemoReadOnlyMessage'))

// Demo service ids — TS object vs Go consts
check('DEMO_SERVICE_IDS.yoga', DEMO_SERVICE_IDS.yoga, goString(demoGo, 'DemoServiceYoga'))
check('DEMO_SERVICE_IDS.pottery', DEMO_SERVICE_IDS.pottery, goString(demoGo, 'DemoServicePottery'))
check(
  'DEMO_SERVICE_IDS.breathwork',
  DEMO_SERVICE_IDS.breathwork,
  goString(demoGo, 'DemoServiceBreathwork'),
)

// ── jobs.go ──────────────────────────────────────────────────────────────────

const jobsGo = readGo('jobs.go')

check('QUEUE_BOOKING_CREATED', QUEUE_BOOKING_CREATED, goString(jobsGo, 'QueueBookingCreated'))
check('QUEUE_BOOKING_CANCELLED', QUEUE_BOOKING_CANCELLED, goString(jobsGo, 'QueueBookingCancelled'))
check('QUEUE_DEMO_REFRESH', QUEUE_DEMO_REFRESH, goString(jobsGo, 'QueueDemoRefresh'))
check('DEMO_REFRESH_CRON', DEMO_REFRESH_CRON, goString(jobsGo, 'DemoRefreshCron'))

// NotificationRecipient
check('NOTIFICATION_RECIPIENT_VALUES', notificationRecipientEnum.options, [
  goString(jobsGo, 'RecipientOrganizer'),
  goString(jobsGo, 'RecipientGuest'),
])

// CancelActor
check('CANCEL_ACTOR_VALUES', cancelActorEnum.options, [
  goString(jobsGo, 'ActorGuest'),
  goString(jobsGo, 'ActorOrganizer'),
])

// ── auth.go ──────────────────────────────────────────────────────────────────

const authGo = readGo('auth.go')

check('LOGIN_LINK_TTL_S', LOGIN_LINK_TTL_S, goInt(authGo, 'LoginLinkTTLSeconds'))
check('LOGIN_LINK_KEY_PREFIX', loginLinkKey(''), goFuncString(authGo, 'LoginLinkKey'))

// ── Report ───────────────────────────────────────────────────────────────────

if (mismatches.length === 0) {
  console.log('contracts in sync (TS ↔ Go)')
  process.exit(0)
}

console.error('contracts out of sync (TS ↔ Go):')
for (const m of mismatches) {
  console.error(`  ${m.name}: TS=${m.ts}  Go=${m.go}`)
}
console.error(
  '\nFix: update the Go constants in apps/web/internal/contracts/ to match packages/contracts.',
)
process.exit(1)
