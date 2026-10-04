# ADR-009: Reserved slugs for system routes

- **Status:** Accepted
- **Date:** 2026-07-29

## Context

Public pages live at `/{orgSlug}` and `/{orgSlug}/{serviceId}` — a flat
namespace. An organizer registering `cabinet`, `api`, or `signup` would shadow a
system route. Slug validation enforced only a 3-char minimum and a charset, with
no reserved values.

## Decision

1. **Reserved slugs** in `packages/contracts/src/primitives.ts` (`RESERVED_SLUGS`,
   rejected by the `slug` schema): `api`, `booking`, `cabinet`, `signup`,
   `login`, `terms`, `privacy` — plus `demo`, added by ADR-010.
2. **Minimum slug length 4** (was 3) — less namespace pressure.
3. **Descriptive system routes:** `/booking/{manageToken}` (renamed from `/b/`),
   `/cabinet/*` stays, organizer pages keep `/{orgSlug}`.

## Rationale

`/{orgSlug}` is the product's primary shareable link — social posts, messenger
messages, QR codes — so it keeps the shortest possible form instead of a prefix
or a subdomain. System routes are clicked, not typed, so they carry full words
for trust and clarity. The reserved list must stay in sync with top-level
routes; extend it whenever a new system route ships.

## Alternatives rejected

- **Single-letter routes (`/b`, `/c`):** cryptic, worse UX/SEO; only the
  organizer page needs brevity.
- **`/o/` or `/org/` prefix:** uglier primary URL for no benefit over the
  reserved list.
- **`cabinet.countmein.group` subdomain:** DNS/SSL complexity; breaks uniform
  messenger deep links.
