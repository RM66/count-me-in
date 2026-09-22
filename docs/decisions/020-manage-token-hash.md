# ADR-020: manageToken hashing — expand phase

- **Status:** Accepted (expand phase; contract phase pending)
- **Date:** 2026-09-22
- **Origin:** consolidated architecture review (glm C3, hy4 P2-6, mimo P1-5, muse C3 — 4 of 5 reviews)

## Context

`manageToken` is a password-equivalent credential: whoever holds it can cancel the booking. It was stored in the clear with a unique index for direct lookup — a database dump leaked live cancel links.

## Decision

Store **SHA-256(token) hex** in `bookings.manage_token_hash` (NOT NULL, unique index) and route every credential check through the hash:

- `CancelGuestBookingByToken` (Go) looks up by hash;
- `getGuestBookingByToken` (TS, the guest management page) looks up by hash;
- the raw token is returned to the guest exactly once — in the `GuestBooking` DTO at booking time — and lives in the deep link, not in any later response.

### Why the raw column stays (expand/contract)

Two flows legitimately need the raw value and cannot work from the hash:

1. **`booking.created` job** builds the management deep link at send time — it must re-issue the raw token in the message.
2. **`ListGuestBookings`** ("lost my link" flow) re-issues links for all of a messenger identity's bookings.

Dropping the raw column (contract phase) requires re-issuing tokens through the notification flow only (a `booking.link.resend` job) and dropping the lookup flow's token echo. That is a product change, not a schema change, so it stays out of this ADR's scope.

### Parity

- Go: `HashManageToken` in [`pkg/db/shared.go`](../../apps/web/pkg/db/shared.go)
- TS: `hashManageToken` in [`packages/contracts/src/manage-token.ts`](../../packages/contracts/src/manage-token.ts)
- DB backfill: migration `0013_manage_token_hash` (built-in `sha256()`, no pgcrypto)

## Consequences

- A database dump no longer leaks usable cancel links; the raw column still exposes deep links for the two re-issue flows — acceptable until the contract phase.
- Lookups are hash-based, so the raw-token unique index becomes redundant; it stays for now as a transition guard and is dropped in the contract phase together with the column.
