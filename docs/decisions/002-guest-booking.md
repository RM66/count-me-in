# ADR-002: Guest booking (no visitor Auth.js accounts)

- **Status:** Accepted (amended 2026-07-18)
- **Date:** 2026-07-18

## Context

Visitors need to reserve seats on public organizer pages. Full Auth.js accounts for every guest increase friction. Contact and verification should align with phone + messengers ([ADR-005](005-phone-messenger.md)).

## Decision

In MVP, **visitors do not have Auth.js accounts**. A booking stores `guestName` + required `guestPhone` (E.164). Verification and cancel authorization use **messenger OTP / one-time links**, not a persistent visitor login.

Auth.js sessions are for **organizers only** (phone-based — see ADR-005).

**Cancel is in MVP:** guest can cancel via token/link from the messenger notification; organizer can cancel from the dashboard. Cancel decrements `bookedCount` in the same transaction.

## Consequences

- Booking funnel stays lighter than “create an account”.
- Phone + messenger OTP gives enough assurance for confirm/cancel without visitor accounts.
- “My bookings” history across organizers is limited until optional visitor accounts (post-MVP).
- Abuse controls: OTP rate limits, Redis TTL, server-side capacity checks.
