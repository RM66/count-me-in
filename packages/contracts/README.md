# @repo/contracts

The single source of truth for the wire contract between the TypeScript client and the Go API.

CountMeIn has two ends of one wire: a React + React Query frontend ([`apps/web/src/api-client`](../../apps/web/src/api-client)) and a Go API ([`apps/web/api`](../../apps/web/api) + [`apps/web/pkg`](../../apps/web/pkg)). They never import each other — the contract between them is HTTP plus the Zod schemas defined **here**. This package owns those schemas, the shared domain rules both sides must agree on, and the manifests that drive cross-language code generation.

Full design rationale: [ADR-014](../../docs/decisions/014-contracts-wire-registry.md), amended by [ADR-015](../../docs/decisions/015-api-route-manifest.md) and [ADR-016](../../docs/decisions/016-standard-openapi-codegen.md).

## How it works

Everything starts as a Zod schema in [`src/`](src). Two manifests feed a standard-toolchain pipeline (ADR-016):

- [`src/wire.ts`](src/wire.ts) — the payload registry: every wire schema registers under its OpenAPI id.
- [`src/routes.ts`](src/routes.ts) — the HTTP surface: method, path, auth, request/response schemas by identity (not re-exported from `index.ts`).

[`apps/web/scripts/generate-openapi.ts`](../../apps/web/scripts/generate-openapi.ts) renders it through **zod-openapi** into one committed OpenAPI 3.1 spec — [`apps/web/openapi.yaml`](../../apps/web/openapi.yaml) — which serves as both the public document and the Go toolchain input (oapi-codegen supports 3.1 since v2.8.0).

**oapi-codegen** (pinned via `go:generate` directives in [`pkg/api/gen/doc.go`](../../apps/web/pkg/api/gen/doc.go)) then emits the Go server interface, types, and the embedded spec used by **kin-openapi** for request validation. Hand-written Go lives around the generated code: `Decode*` entry points and refinements in [`pkg/validation`](../../apps/web/pkg/validation), domain logic in [`pkg/contracts/domain.go`](../../apps/web/pkg/contracts/domain.go), constants in [`pkg/contracts/constants_gen.go`](../../apps/web/pkg/contracts/constants_gen.go) (rendered by [`generate-constants.ts`](../../apps/web/scripts/generate-constants.ts)).

CI verifies freshness with `git diff --exit-code` — a schema change that wasn't regenerated shows up as a diff.

## The wire registry

[`src/wire.ts`](src/wire.ts) is the payload manifest. Every wire schema is registered under its OpenAPI id:

```ts
register(createBookingInput, { id: 'CreateBookingInput' })
```

Component schemas are emitted sorted by byte order (deterministic across machines — see `byBytes` in [`src/openapi.ts`](src/openapi.ts)), not in registration order. Schemas that never appear as HTTP bodies (Redis/QStash payloads marked `x-internal`) are still registered — they document the shape even where oapi-codegen emits no Go type (those live hand-written in [`pkg/contracts/payloads.go`](../../apps/web/pkg/contracts/payloads.go)).

### The route manifest

[`src/routes.ts`](src/routes.ts) is the HTTP-surface manifest (not re-exported from `index.ts`). Every operation is a data record: method, path, auth, request schema (by identity), responses, and — for the three partial-update endpoints — `requestContentType: 'application/merge-patch+json'` (RFC 7386: absent key = keep, explicit `null` = clear).

Invariants, pinned by [`src/routes.test.ts`](src/routes.test.ts):

- operation ids are unique
- method+path pairs are unique
- every referenced schema is registered in `wire.ts`
- a rate-limited route documents 429
- `sessionWritable` documents 403 and never 401 (ADR-010)

The mux is now the generated oapi-codegen router itself ([`pkg/api`](../../apps/web/pkg/api)), so spec ↔ handler drift is a compile error, not a test failure.

## What lives where

### Wire schemas (`src/`)

One file per entity, each holding its input, update, and record schemas built from shared primitives:

- [`primitives.ts`](src/primitives.ts) — scalar building blocks (`slug`, `displayName`, `capacity`, `seats`, `uuid`, …) and their bounds (`BOUNDS`).
- [`enums.ts`](src/enums.ts) — shared enumerations (`BookingStatus`, `Messenger`, `OptionsSelectMode`).
- [`organizer.ts`](src/organizer.ts), [`service.ts`](src/service.ts), [`time-slot.ts`](src/time-slot.ts), [`booking.ts`](src/booking.ts) — entity schemas.
- [`auth.ts`](src/auth.ts) — ticket and Telegram widget schemas.
- [`storage.ts`](src/storage.ts) — image upload input/target schemas.
- [`jobs.ts`](src/jobs.ts) — QStash queue names and job payloads.
- [`routes.ts`](src/routes.ts) — HTTP surface (method, path, auth, request/response); subpath export, not in `index.ts`.
- [`envelopes.ts`](src/envelopes.ts) — typed response wrappers (`ServiceEnvelope`, `SlotEnvelope`, …).
- [`i18n.ts`](src/i18n.ts) — supported locales, `matchLocale`.
- [`demo.ts`](src/demo.ts) — demo organizer id/slug/constants.

### Shared domain logic

Rules that are **isomorphic** — the public page, the cabinet, and the notification worker must all agree — live here, not in `apps/web`:

- [`time-slot.ts`](src/time-slot.ts) — [`seatsLeft()`](src/time-slot.ts:105), [`fillLabel()`](src/time-slot.ts:119), [`slotEnd()`](src/time-slot.ts:147), [`slotPrice()`](src/time-slot.ts:157).
- [`service.ts`](src/service.ts) — [`effectiveLocation()`](src/service.ts:128), [`effectiveContact()`](src/service.ts:136) (service overrides organizer).
- [`options.ts`](src/options.ts) — [`buildSelectedOptionsSchema()`](src/options.ts:39) (validates a booking's options against a concrete service).
- [`timezone.ts`](src/timezone.ts) — [`wallClockToInstant()`](src/timezone.ts:73), [`instantToWallClockInputs()`](src/timezone.ts:94) (wall-clock ↔ instant for a named zone).
- [`jobs.ts`](src/jobs.ts) — [`cancelNotificationRecipient()`](src/jobs.ts:76).
- [`demo.ts`](src/demo.ts) — [`isDemoOrganizerId()`](src/demo.ts:52).

### Form schemas (`*-form.ts`)

Form schemas are **not** wire schemas. A controlled input holds a `string` (including `''` mid-edit), while the API takes numbers and `null`. Each entity has a `*-form.ts` beside its wire schema, built with shared adapters from [`form-fields.ts`](src/form-fields.ts):

- [`optionalText()`](src/form-fields.ts:13) — `''` → `null`.
- [`numericText()`](src/form-fields.ts:21) — string → number, rejecting empty as "required" instead of coercing to `0`.

Form schemas are excluded from the wire registry (listed in `TS_ONLY` in [`wire.test.ts`](src/wire.test.ts)) so they stay out of the client bundle's codegen path.

## Testing & parity

Two mechanisms keep TypeScript and Go in lockstep:

### Shared vectors ([`vectors/`](vectors))

Single JSON test sets, run by **both** vitest and `go test`:

- [`vectors/validation/`](vectors/validation) — one file per input/update schema. Each case carries a body and the expected `valid`, `fieldErrors` keys, and `formErrors` count. Comparison is structural, never message text (Go deliberately deviates on messages like `"Required"`).
- [`vectors/domain/`](vectors/domain) — one file per domain function (`seatsLeft`, `slotPrice`, `matchLocale`, `effectiveLocation`, …).

A coverage test in [`vectors.test.ts`](src/vectors.test.ts) fails if any input/update schema lacks a vector file, a valid case, or per-field error cases.

### Golden samples

Go writes golden JSON per record into [`apps/web/pkg/contracts/testdata/golden/`](../../apps/web/pkg/contracts/testdata/golden). Vitest parses each with its Zod schema, proving a marshalled Go record is valid on the TS side (the response direction). A missing golden for any record fails `TestGoldenCoverage`.

### Tripwires

- [`wire.test.ts`](src/wire.test.ts) — every Zod export is registered or listed in `TS_ONLY`; ids are unique; update schemas accept `{}` (merge-patch no-op).
- [`routes.test.ts`](src/routes.test.ts) — unique operation ids and method+path pairs; every referenced schema is registered; rate-limited routes document 429; `sessionWritable` documents 403 and never 401.

## Adding a schema

Three steps (from [ADR-014](../../docs/decisions/014-contracts-wire-registry.md), [ADR-015](../../docs/decisions/015-api-route-manifest.md), [ADR-016](../../docs/decisions/016-standard-openapi-codegen.md)):

1. **Build it from registered primitives and `register()` it in [`wire.ts`](src/wire.ts).** Forgetting fails the completeness test in [`wire.test.ts`](src/wire.test.ts). If Go needs a hand-written refinement, add it in [`apps/web/pkg/validation/refine.go`](../../apps/web/pkg/validation/refine.go) and call it from the matching `Decode*` in [`decode.go`](../../apps/web/pkg/validation/decode.go).
2. **Regenerate:** `bun run generate:openapi && bun run generate:constants && go generate ./pkg/api/...` (from `apps/web`; `bun run build:go` runs the full chain). Then add a validation vector in [`vectors/validation/{Id}.json`](vectors/validation) (else the coverage test is red), and for records a golden sample in [`apps/web/pkg/contracts/testdata/golden/{Id}.json`](../../apps/web/pkg/contracts/testdata/golden) (else `TestGoldenCoverage` is red).
3. **If it crosses the wire, add the operation to [`src/routes.ts`](src/routes.ts)** — the generated router and spec derive from it, so a schema without a route is an orphan.

## Scripts

```sh
bun run test               # vitest (this package)
bun run generate:openapi   # render both OpenAPI specs (run from apps/web)
bun run generate:constants # render pkg/contracts/constants_gen.go (run from apps/web)
go generate ./pkg/api/...  # oapi-codegen: types, server interface, embedded spec
```

The generators are defined in [`apps/web`](../../apps/web/package.json) and orchestrated by Turborepo from the repo root. `generate-openapi.ts` computes all artifacts before writing any, so a failure leaves the tree untouched.
