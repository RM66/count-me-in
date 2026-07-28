# ADR-002: Guest booking (no visitor Auth.js accounts)

- **Status:** Accepted (amended 2026-07-28)
- **Date:** 2026-07-18

## Context

Visitors need to reserve seats on public organizer pages. Full Auth.js accounts for every guest increase friction. Identity and verification align with messenger accounts ([ADR-008](008-messenger-only-auth.md); originally phone + OTP per superseded [ADR-005](005-phone-messenger.md)).

## Decision

In MVP, **visitors do not have Auth.js accounts**. A booking stores `guestName` + the guest's messenger identity (`guestMessenger` + `guestMessengerId`), captured by authenticating with the **Telegram Login Widget** on the booking page (server-side HMAC validation, short-lived ticket). No phone, no OTP.

Auth.js sessions are for **organizers only** (messenger-based — see ADR-008).

**Cancel is in MVP, via a booking management page** (no visitor account). The page shows the booking and a Cancel button, and is reachable two ways:

1. **Deep link** in the messenger notification — `https://countmein.group/b/{manageToken}`. The link was delivered to the guest's verified messenger account, which is itself proof of ownership. `manageToken` is an opaque secret stored **hashed** on the booking.
2. **Messenger lookup** — the guest re-authenticates with the same messenger account (widget) and sees the bookings for that `(guestMessenger, guestMessengerId)`. Useful if the original message is lost.

Organizers can also cancel from the web cabinet. Cancel sets `cancelled` and decrements `bookedCount` in the same transaction.

This replaces the earlier bare "cancel token" idea: a single management surface is easier to extend (e.g. show status, later reschedule) and both entry paths reuse the messenger trust model already in the product.

## Consequences

- Booking funnel stays lighter than “create an account”; widget auth is one tap for Telegram users.
- A signed messenger identity gives enough assurance for confirm/cancel without visitor accounts.
- Guests without Telegram cannot book in MVP (see ADR-008); more messengers mitigate this later.
- “My bookings” history across organizers is limited until optional visitor accounts (post-MVP).
- Abuse controls: ticket TTL, rate limits in Redis, server-side capacity checks.
