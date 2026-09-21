# ADR-005: Phone identity and messenger notifications

- **Status:** Superseded by [ADR-008](008-messenger-only-auth.md)
- **Date:** 2026-07-18

## Summary

Made the phone number (E.164) the primary identity for organizers and guests, verified by OTP delivered over a messenger (Auth.js), with messengers as the primary notification channel and Telegram as the first provider.

**Superseded (ADR-008, 2026-07-28):** the phone added friction and infrastructure (OTP codes, resend limits, E.164 normalization) while the messenger account already provides a verifiable identity — the Telegram Login Widget returns an HMAC-signed payload with a stable user id. ADR-008 removed phone and OTP entirely; identity is the `messenger` + `messengerId` pair. The messenger-first notification strategy and Telegram-first provider ordering survive in ADR-008.
