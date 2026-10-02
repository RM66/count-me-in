# ADR-024: API hardening & contract convergence

- **Status:** Accepted — implemented. The full phase plan is preserved in git history.
- **Date:** 2026-09
- **Amends:** [ADR-016](016-standard-openapi-codegen.md) (request validation now runs off the bundled spec artifact), [ADR-021](021-api-python-rewrite.md)

## Context

A review found hard-edge cases and spec drift: `RestorePathMiddleware` honored
a client-supplied `_path` on **any** request path; `spec.py` failed **open** if
`openapi.yaml` was absent from the deployed bundle; `deleteService` documented
"cascade" and omitted the real 409, `listSlots`' `upcoming` enum was declared
but unenforced, `listBookings` hand-parsed `limit`/`offset`; the guest ticket
was consumed **before** domain refusals (a SoldOut forced re-auth); `code` was
emitted by only three errors; the three merge-patch endpoints were `PUT`; no
`statement_timeout`; and validation was permanently hand-mirrored between Zod
and Pydantic.

## Decision

**Hardening.**

- `_path` restore binds to `scope["path"] == "/api/index"` — the only path the
  `vercel.json` rewrite can produce; `_path` elsewhere cannot steer dispatch.
- `generate:openapi` also emits `contracts/spec_gen.json` (inside
  `includeFiles`); `spec.py` loads it and **fails closed** — a missing artifact
  is a loud 500, never a silently permissive validator.
- Spec drift closed: `deleteService` documents the 409, `upcoming` enforced via
  `Literal["1"]`, `listBookings` uses `Query(ge=…)` bounds.
- `statement_timeout=8000` via libpq `options` on both engine configs; jobs
  that legitimately run longer set `SET LOCAL` inside their transaction.
- `code` on every error body — defaults to the i18n `response_key`; finer codes
  kept where the client already branches (`demo_read_only`, `duplicate_booking`,
  `invalid_option`); `errorBody.code` is required on the wire.
- Minors: `R2_*` joined the required env vars; `writable_state` pinned per
  merge-patch entity by test; `hasMore` on the bookings envelope (`limit+1`
  fetch); `iss`/`aud` minted and verified on the organizer-token JWT.

**Semantics.**

- Guest ticket consumption moved **past** domain refusals:
  `SlotGone`/`InvalidOptions`/`PartyTooLarge`/`SoldOut` no longer burn the
  ticket — the guest retries with different seats without re-running the
  widget. It is consumed only when a booking is genuinely attempted.
- The three merge-patch endpoints are `PATCH` (RFC 7386), not `PUT`.
- `assert_matches_spec` validates real handler responses against
  `spec_gen.json` in tests — serializer drift is a red test, not a shipped body.

**Convergence — the spec is the validator.**

- `decode` runs: raw dict → declared transforms → `jsonschema` against
  `spec_gen.json` → declared field rules/refinements → DTO via
  `model_construct`. Pydantic models are typed DTOs only, never the validator —
  JSON Schema handles nullability, patterns, and coercion natively, removing
  the lax-coercion and TypeError-fallback workarounds.
- `wire.ts` `register()` carries `validation` metadata (transforms, field
  rules, refinements, `mergedRequired`) rendered to `validation/rules_gen.py`;
  the per-schema hand-written mirrors were deleted. Vectors and parity goldens
  pin behavior unchanged.
- Rejected: BFF-side Zod validation (the API must self-validate), a Node
  sidecar (a hop per request), a third neutral DSL (JSON Schema already is
  one).

## Out of scope (accepted)

ICU stays a subset (`{param}` + `plural`); observability stays structured logs
+ trace ids; no `/api/v1` for a single private consumer; `manage_token`
plaintext column stays for the re-issue flows (ADR-020).
