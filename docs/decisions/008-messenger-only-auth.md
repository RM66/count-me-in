# ADR-008: Messenger-only identity and display contact field

- **Status:** Accepted
- **Date:** 2026-07-28
- **Supersedes:** [ADR-005](005-phone-messenger.md); amends [ADR-002](002-guest-booking.md)

## Context

ADR-005 made the phone number the primary identity for organizers and guests, verified by OTP delivered over a messenger. In practice the phone adds friction and infrastructure (OTP codes, resend limits, E.164 normalization) while the messenger account already provides a verifiable identity: the Telegram Login Widget returns a signed (HMAC) payload with a stable user id. The interim state — Telegram login bolted onto a required `phone` column via placeholder values — is inconsistent and must be resolved.

Separately, organizers need a way to show guests _how to reach them_ that is not tied to auth: a phone, an email, or a social link, purely for display.

## Decision

1. **Identity = messenger account.** An account is identified by the pair `messenger` + `messengerId` (unique together). MVP ships `telegram` (Telegram user id); other messengers become new enum variants with their own auth adapters later. **No `phone` column, no OTP.**
2. **Organizer auth:** Telegram Login Widget → server-side HMAC validation (Auth.js credentials provider). Existing pair → session; unknown pair → signup (profile form), with the validated identity carried in a short-lived server-side ticket (Redis) — never trusted from the client.
3. **Guest booking:** the guest authenticates with the same widget on the booking page. `Booking` stores `guestMessenger` + `guestMessengerId` instead of `guestPhone`. Notifications go to the guest's messenger account; "my bookings" lookup matches the authenticated messenger identity. The `manageToken` deep link is unchanged.
4. **Contact field:** optional free-text `contact` on `Organizer` and `Service`; `Service.contact` overrides the organizer's (same fallback rule as `location`). Stored as one universal string. At render time a pure function classifies the text (phone / email / URL / plain) and the UI wraps it in `tel:` / `mailto:` / `https:` links accordingly. Display-only — no auth or notification role.
5. **DB reset:** the schema is regenerated from scratch (drop + fresh initial migration); no data migration from the phone-based model.

## Consequences

- Signup collapses to widget auth + one profile form; no OTP request/verify endpoints, no code/cooldown/attempt keys in Redis (short-lived auth tickets and rate limits remain).
- Redis OTP sender/adapter work is dropped; the worker addresses guests by messenger chat id directly.
- **Bot-start constraint:** Telegram bots can only message users who pressed **Start**. Booking/notification UX must include a "start the bot" step (`t.me/<bot>?start=…`) after widget auth; delivery failure needs a visible fallback (management deep link shown on-screen).
- Phone-based booking lookup disappears; a guest who loses the deep link recovers bookings by re-authenticating with the same messenger account.
- Adding a messenger later = new enum variant + auth adapter + notification adapter; the `(messenger, messengerId)` pair already generalizes.
- Guests without Telegram cannot book in MVP — accepted trade-off, mitigated later by more messengers.
