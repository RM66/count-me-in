# ADR-015: API route manifest (`packages/contracts/src/routes.ts`)

- **Status:** Accepted
- **Date:** 2026-09-18
- **Amends:** ADR-014 (the manifest is now `wire.ts` for payloads **and** `routes.ts` for the HTTP surface)

## Context

ADR-014 made `wire.ts` the payload manifest: every Zod schema that crosses the language boundary registers, and Go structs, rules, parsers and OpenAPI `components.schemas` derive from one `z.toJSONSchema(wire)` call. The HTTP surface was left out. Three concrete symptoms followed:

1. **Undocumented operations.** `GET /api/services`, `GET /api/services/{id}`, `GET /api/slots` and `GET /api/slots/{id}` existed in `pkg/routes/mux.go` but not in `openapi.yaml`. `check-api-routes.ts` compared path strings only, so it stayed green.
2. **Hand-written `paths`.** The generator owned a ~420-line OpenAPI `paths` literal. Adding an endpoint meant editing the mux, the spec, and the checker independently; none of those edits was forced by the others.
3. **Records reused input policy.** The `slug` primitive carried the reserved-name refinement used at registration. Response DTOs reused it, so `GET /api/organizers/me` failed its own Zod schema for every anonymous cabinet visitor — the demo organizer's slug is `demo`, which is reserved (ADR-010).

The endpoint layer was not in the contract, and records reused request policy.

## Decision

- **D1 — `routes.ts` is the route manifest.** Schemas describe payloads; `packages/contracts/src/routes.ts` describes where they travel. Operations reference Zod schemas by identity (a typo is a type error); the generator resolves the wire id through the registry. OpenAPI `paths` and Go `contracts.APIRoutes` derive from the same table. The file is a subpath export (`@repo/contracts/routes`) and is **not** re-exported from `index.ts`, so it does not enter the client bundle.
- **D2 — Mux parity is a test.** `pkg/routes/manifest_test.go` asserts both directions: every declared operation is dispatchable, and no undeclared method on a declared path is. `check:api-routes` asserts spec↔manifest at method level and `vercel.json`↔mux at path level.
- **D3 — Orphan schemas fail generation.** A registered schema reachable from no operation (and not pinned as an internal Redis record) is an error. Transitive `$ref` walks cover envelopes (`ServiceRecord` via `ServiceEnvelope`) and primitives. Redis payloads (`AuthTicketPayload`, `LoginLinkPayload`) are listed in `INTERNAL_RECORDS` and `$ref`'d from the spec's `x-internal` extension — they travel as JSON, just not over HTTP.
- **D4 — Shape and policy are separate primitives.** `slugShape` describes a stored value (length, alphabet, lowercase); `slug` adds the registration policy (not in `RESERVED_SLUGS`). Records use shape primitives; inputs use policy primitives. The rule is general: a response DTO must never fail its own schema because of a request-only constraint.
- **D5 — Render direction follows kind.** Records render `io: 'output'`, requests and shared primitives `io: 'input'`. `additionalProperties: false` is stripped in both directions, with an assertion that the strip did something — otherwise the handling is dead code again.
- **D6 — One implementation per contract.** `x-go-skip` is removed. The Telegram widget payload is an `input` parsed by the generated parser; only the HMAC data-check-string (which must cover fields the schema does not model) stays hand-written.
- **D7 — Artifact ownership.** The generator and all three of its outputs live in `apps/web` (`contracts_gen.go`, `validation_gen.go`, `openapi.yaml`). `packages/contracts` holds only hand-written TypeScript. Spec `info.version` is a content digest of the emitted components, not a stale literal.

The four owner-scoped GET endpoints in (1) are kept: they cost nothing, pages already read Postgres directly, and removing a route is a product decision. They are now in the manifest and the spec.

## Consequences

- **Adding a schema** is six steps: the five from ADR-014, plus **add the operation to `routes.ts`** if it crosses the wire — otherwise generation fails with an orphan-schema error.
- **Tripwires and what each one catches:**
  - `routes.test.ts` — unique ids/paths, registered schemas, 429 iff rate-limited, `sessionWritable` ⇒ 403 never 401.
  - `pkg/routes/manifest_test.go` — mux missing a declared operation, or dispatching an undeclared method.
  - `check:api-routes` — OpenAPI operations drifting from the manifest; `vercel.json` drifting from the mux.
  - Orphan-schema assertion — a registered schema no path (or `INTERNAL_RECORDS`) reaches.
  - `arrayElemRule` throw, RE2 regex check, double-`register()` of one object, Go field-name collision — authoring errors that used to be silent or a cold-start panic.
  - `messages.test.ts` — Zod default wording drifting from the Go templates.
  - Golden `.demo` / `.bounds` variants — response DTOs that used to fail on reserved slugs or max-length UTF-16 strings.
- **Known remaining divergences** (carried over from ADR-014, plus one new): Postgres `char_length` counts code points, `charLen` counts UTF-16 units — they disagree only on astral characters, where Postgres is more permissive; `z.url()` still trims surrounding whitespace at runtime while Go's `URLRule` validates the value verbatim.
