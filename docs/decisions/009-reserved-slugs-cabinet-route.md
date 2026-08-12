# ADR-009: Reserved slugs for system routes

**Status:** Accepted
**Date:** 2026-07-29
**Deciders:** Product, Engineering

## Context

CountMeIn uses a flat URL scheme where organizer public pages live at `/{orgSlug}` and
`/{orgSlug}/{serviceId}`. This creates a potential conflict with system routes:

- `/cabinet/*` — organizer cabinet (authenticated)
- `/booking` and `/booking/{manageToken}` — guest booking management
- `/api/*` — HTTP API
- `/` — landing page
- `/signup`, `/login` — auth flows
- `/terms`, `/privacy` — legal pages

An organizer could register a slug like `"cabinet"`, `"booking"`, `"api"`, or `"signup"`,
which would shadow the system routes and break the application. The current slug validation
([`packages/contracts/src/primitives.ts`](../../packages/contracts/src/primitives.ts))
enforces a minimum length of 3 characters and a pattern of lowercase letters, digits, and
hyphens, but does **not** reserve any specific values.

## Decision

1. **Reserve system route prefixes** in slug validation:
   - `"api"`, `"booking"`, `"cabinet"`, `"signup"`, `"login"`, `"terms"`, `"privacy"`
   - Reject any slug that exactly matches a reserved word (case-insensitive after normalization).

2. **Use descriptive route names** for system routes:
   - `/booking/{manageToken}` instead of `/b/{manageToken}` — clearer for users and SEO
   - `/cabinet/*` remains unchanged — already descriptive
   - Public organizer pages stay at `/{orgSlug}` — shortest possible shareable link

3. **Increase minimum slug length** from 3 to 4 characters:
   - Reduces namespace pressure on short slugs.
   - Provides additional buffer against future system routes.
   - Still allows readable, memorable handles (e.g., `"yoga"`, `"studio"`).

## Rationale

**Why keep `/{orgSlug}` without a prefix?**

- The organizer public page (`countmein.group/studio-lumen`) is the **primary shareable link**.
- It appears in social media posts, messenger messages, printed materials, and QR codes.
- Shorter URLs are easier to remember, type, and share.
- SEO benefits from clean, keyword-rich URLs.

**Why use `/booking` instead of `/b`?**

- Deep links are delivered via messenger notifications — users don't type them manually.
- Descriptive URLs improve trust and clarity when users see them in their browser.
- Better for SEO and analytics (clear intent in URL structure).
- Consistency: `/cabinet` is already a full word; `/booking` matches that pattern.

**Why not prefix organizer slugs with `/o/` or `/org/`?**

- Adds unnecessary length to the most frequently shared URL.
- The public page is the product's primary surface — it should have the cleanest URL.
- Reserved slugs provide sufficient protection without compromising UX.

## Consequences

### Positive

- **No route conflicts:** System routes are protected; organizers cannot shadow them.
- **Clean public URLs:** `countmein.group/studio-lumen` is short and memorable.
- **Self-documenting system routes:** `/cabinet/services`, `/booking/abc123` are clear.
- **SEO-friendly:** Descriptive URLs improve search engine understanding and user trust.
- **Future-proof:** Reserved list can be extended as new system routes are added.

### Negative

- **Migration required:** Existing organizers with 3-character slugs or reserved slugs must
  be migrated (not applicable in MVP — no production data yet).
- **Slightly less flexible:** Organizers cannot use very short (1–3 char) or reserved slugs,
  but this is a reasonable trade-off for system stability.

### Neutral

- The reserved list must be maintained in sync with actual Next.js routes. A test should
  verify that all top-level route segments are either reserved or match the dynamic
  `[orgSlug]` catch-all.

## Implementation

1. Update [`packages/contracts/src/primitives.ts`](../../packages/contracts/src/primitives.ts):
   - Change `slug` schema: `.min(3)` → `.min(4)`.
   - Add `.refine()` to reject reserved words: `"api"`, `"booking"`, `"cabinet"`, `"signup"`, `"login"`, `"terms"`, `"privacy"`.

2. Rename booking management routes:
   - `apps/web/app/(guest)/b/` → `apps/web/app/(guest)/booking/`
   - Update all references to `/b/` → `/booking/` in code and documentation.

3. Update all hardcoded route references:
   - Auth.js callbacks, redirects, deep link generation in worker notifications.
   - Documentation ([`AGENTS.md`](../../AGENTS.md), [`pages.md`](../pages.md),
     [`architecture.md`](../architecture.md)).

4. Add a validation test ensuring reserved slugs are rejected.

## Alternatives considered

### Use short routes (`/b`, `/c`) for all system routes

- **Rejected:** While shorter, single-letter routes are cryptic and hurt UX/SEO. The
  public organizer page is the only URL users share manually, so it should be short.
  System routes (deep links, cabinet) are accessed via clicks, not typing.

### Prefix organizer slugs with `/o/` or `/org/`

- **Rejected:** Uglier URLs for the primary public-facing surface. The organizer page
  (`/{orgSlug}`) is the main shareable link; it should be as clean as possible.

### Use a subdomain for the cabinet (`cabinet.countmein.group`)

- **Rejected:** Adds DNS/SSL complexity, complicates local development, and breaks the
  simplicity of messenger deep links (which would need to switch domains).

## Related

- [ADR-001: Monorepo layout](001-monorepo-layout.md) — Next.js app structure.
- [ADR-002: Guest booking without Auth.js accounts](002-guest-booking.md) — the booking management route this ADR renamed to `/booking/{manageToken}`.
- [Domain model](../domain.md) — `Organizer.slug` as the public identifier.
- [Pages / routes](../pages.md) — Full site map.
