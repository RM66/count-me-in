# Generated from packages/contracts via scripts/generate-constants.ts
# (ADR-021). Contains only derived constants; hand-written code lives in
# domain.py / payloads.py. Regenerate with: bun run generate:constants

# Demo account (ADR-010).
DEMO_ORGANIZER_ID = "01930000-0000-7000-8000-0000000000de"
DEMO_ORGANIZER_SLUG = "demo"
DEMO_READ_ONLY_CODE = "DEMO_READ_ONLY"
DEMO_READ_ONLY_MESSAGE = "This is a read-only demo account — sign up to create your own bookable services."
DEMO_SERVICE_YOGA = "demo-yoga"
DEMO_SERVICE_POTTERY = "demo-pottery"
DEMO_SERVICE_BREATHWORK = "demo-breathwork"

# QStash queues (ADR-012).
QUEUE_BOOKING_CREATED = "booking.created"
QUEUE_BOOKING_CANCELLED = "booking.cancelled"
QUEUE_DEMO_REFRESH = "demo.refresh"
QUEUE_OUTBOX_SWEEP = "notification.outbox.sweep"

# One-time login links. The prefix is generated from the TS constant, so the
# Python writer and the TS reader cannot disagree on the Redis key.
LOGIN_LINK_TTL_SECONDS = 2592000
LOGIN_LINK_KEY_PREFIX = "auth:login-link:"

# Slot validation tolerance.
SLOT_START_TOLERANCE_MS = 60000
SLOT_START_IN_PAST_MESSAGE = "Pick a time in the future — guests cannot book a session that has already started"

# Locales — language switcher order (ADR-011).
LOCALES = ["en", "de", "es", "fr", "pt", "ru", "ar", "ja"]

DEFAULT_LOCALE = "en"

# Auth.js session cookie names, https ("__Secure-"-prefixed, prod) first.
SESSION_COOKIE_NAMES = ["__Secure-authjs.session-token", "authjs.session-token"]
