// Generated from packages/contracts via scripts/generate-constants.ts
// (ADR-016, Phase 5). Contains only derived constants; hand-written code
// lives in domain.go / flex.go. Regenerate with: bun run generate:constants
package contracts

// Demo account (ADR-010).
const (
	DemoOrganizerID       = "01930000-0000-7000-8000-0000000000de"
	DemoOrganizerSlug     = "demo"
	DemoReadOnlyCode      = "DEMO_READ_ONLY"
	DemoReadOnlyMessage   = "This is a read-only demo account — sign up to create your own bookable services."
	DemoServiceYoga       = "demo-yoga"
	DemoServicePottery    = "demo-pottery"
	DemoServiceBreathwork = "demo-breathwork"
)

// QStash queues (ADR-012).
const (
	QueueBookingCreated   = "booking.created"
	QueueBookingCancelled = "booking.cancelled"
	QueueDemoRefresh      = "demo.refresh"
	QueueOutboxSweep      = "notification.outbox.sweep"
)

// One-time login links. The prefix is generated from the TS constant, so the
// Go writer and the TS reader cannot disagree on the Redis key.
const (
	LoginLinkTTLSeconds = 2592000
	LoginLinkKeyPrefix  = "auth:login-link:"
)

// Slot validation tolerance.
const (
	SlotStartToleranceMS   = 60000
	SlotStartInPastMessage = "Pick a time in the future — guests cannot book a session that has already started"
)

// Locales — language switcher order (ADR-011).
var Locales = []string{"en", "de", "es", "fr", "pt", "ru", "ar", "ja"}

const DefaultLocale = "en"

// Auth.js session cookie names, https ("__Secure-"-prefixed, prod) first.
var SessionCookieNames = []string{"__Secure-authjs.session-token", "authjs.session-token"}
