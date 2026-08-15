# ADR-005: Phone identity and messenger notifications

- **Status:** Superseded by [ADR-008](008-messenger-only-auth.md)
- **Date:** 2026-07-18

> **Superseded (2026-07-28):** phone identity and OTP are removed entirely. Identity is the messenger account (`messenger` + `messengerId`); Telegram Login Widget for organizers and guests. Messenger-first notifications and the Telegram-first provider strategy survive in ADR-008.

## Context

Product defaults initially assumed email for organizer auth and booking notifications. The product domain is `countmein.group`, and the preferred contact model is phone + messengers (Telegram, WhatsApp, Viber, etc.), not email.

## Decision

1. **Identity:** primary user identifier is **phone number** on `Organizer` (`phone` required, E.164). Organizer sign-up / sign-in uses phone OTP via messenger (Auth.js). `Organizer.id` is the Auth.js user id — no separate `userId`.
2. **Guest booking:** `guestPhone` required; name required. Messenger OTP **before** insert; booking created atomically as `confirmed`. See [domain](../domain.md).
3. **Notifications:** messengers are the **primary** channel. Email not required for MVP.
4. **MVP provider:** **Telegram** first; other messengers as adapters later.
5. **Channel:** persist `Organizer.messenger` (and `Booking.messenger` for guests) from the channel that successfully delivered OTP, and reuse it for subsequent OTP/notifications.
6. **Public URL:** `https://countmein.group/{orgSlug}`.

## Consequences

- Worker grows a notification adapter interface; Telegram is the first adapter.
- OTP codes and rate limits live in Redis (short TTL); phones in E.164.
- Persisting `messenger` reduces “which channel?” ambiguity on repeat login/notify.
- Dependency on messenger reachability for that phone.
- Auth.js is phone/OTP-centric, not email-centric.
- The guest booking management link goes out on the same messenger path as confirmation ([ADR-002](002-guest-booking.md)).
