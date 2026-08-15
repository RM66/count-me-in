# ADR-006: Organizer client — web cabinet in MVP; Capacitor later

- **Status:** Accepted (amended 2026-07-19)
- **Date:** 2026-07-19

## Context

Organizers need a way to manage services, slots, and bookings, and to learn about new bookings. A dedicated Capacitor app (`apps/organizer`) was considered for store/PWA shells, but it doubles frontend surface area (auth, build, release) before product-market fit.

Desired MVP flow:

1. Organizer registers via messenger login widget (Telegram).
2. Booking notifications arrive in that messenger.
3. Each message includes a link to the organizer cabinet.
4. The link opens in the messenger **WebView** (or system browser) — responsive web pages in `apps/web`.

## Decision

**MVP:** organizer cabinet lives in **`apps/web`** (e.g. `/cabinet` or `/org/...`), same Next.js app as landing + public booking + API. No `apps/organizer`, no Capacitor, no PWABuilder in MVP.

**Post-MVP:** if organizers need a store app or stronger native UX, extract or wrap the cabinet with **Capacitor** (preferred over PWABuilder — see prior analysis). Until then, messenger + deep link is the “app” entry point.

Notification messages must include a stable absolute URL to the relevant cabinet view (dashboard, booking detail, etc.), preferably with session-friendly auth (cookie after login, or short-lived magic link that establishes session).

## Consequences

- One frontend to build and ship for MVP; faster iteration.
- UX depends on messenger WebView quality (Telegram is usually fine).
- Deep links and mobile-responsive cabinet UI are first-class requirements.
- Capacitor remains a phase-2+ option, not a monorepo requirement for MVP.
