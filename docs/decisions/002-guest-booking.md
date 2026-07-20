# ADR-002: Guest booking (no visitor Auth.js accounts)

- **Status:** Accepted (amended 2026-07-20)
- **Date:** 2026-07-18

## Context

Visitors need to reserve seats on public organizer pages. Full Auth.js accounts for every guest increase friction. Contact and verification should align with phone + messengers ([ADR-005](005-phone-messenger.md)).

## Decision

In MVP, **visitors do not have Auth.js accounts**. A booking stores `guestName` + required `guestPhone` (E.164). Verification and cancel authorization use **messenger OTP / one-time links**, not a persistent visitor login.

Auth.js sessions are for **organizers only** (phone-based — see ADR-005).

**Cancel is in MVP, via a booking management page** (no visitor account). The page shows the booking and a Cancel button, and is reachable two ways:

1. **Deep link** in the messenger notification — `https://countmein.group/b/{manageToken}`. The link was delivered to the verified phone's messenger, which is itself proof of ownership, so no additional OTP is required. `manageToken` is an opaque secret stored **hashed** on the booking.
2. **Phone + OTP lookup** — the guest enters their phone, gets a messenger OTP (Redis TTL), and sees the bookings for that phone. Useful if the original message is lost.

Organizers can also cancel from the web cabinet. Cancel sets `cancelled` and decrements `bookedCount` in the same transaction.

This replaces the earlier bare "cancel token" idea: a single management surface is easier to extend (e.g. show status, later reschedule) and both entry paths reuse the phone + messenger trust model already in the product.

## Consequences

- Booking funnel stays lighter than “create an account”.
- Phone + messenger OTP gives enough assurance for confirm/cancel without visitor accounts.
- “My bookings” history across organizers is limited until optional visitor accounts (post-MVP).
- Abuse controls: OTP rate limits, Redis TTL, server-side capacity checks.
