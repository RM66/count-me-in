# @repo/contracts

The single source of truth for the wire contract between the TypeScript client and the Python API.

CountMeIn has two ends of one wire: a React + React Query frontend ([`apps/web/src/api-client`](../../apps/web/src/api-client)) and a Python API ([`apps/web/api/_lib/countmein`](../../apps/web/api/_lib/countmein)). They never import each other — the contract between them is HTTP plus the Zod schemas defined **here**. This package owns those schemas, the shared domain rules both sides must agree on, and the manifests that drive cross-language code generation.

Full design rationale: [ADR-014](../../docs/decisions/014-contracts-wire-registry.md), amended by [ADR-015](../../docs/decisions/015-api-route-manifest.md) and [ADR-016](../../docs/decisions/016-standard-openapi-codegen.md).

## How it works

Everything starts as a Zod schema in [`src/`](src). Two manifests feed a standard-toolchain pipeline (ADR-016):

- [`src/wire.ts`](src/wire.ts) — the payload registry: every wire schema registers under its OpenAPI id.
- [`src/routes.ts`](src/routes.ts) — the HTTP surface: method, path, auth, request/response schemas by identity (not re-exported from `index.ts`).

[`apps/web/scripts/generate-openapi.ts`](../../apps/web/scripts/generate-openapi.ts) renders it through **zod-openapi** into one committed OpenAPI 3.1 spec — [`apps/web/openapi.yaml`](../../apps/web/openapi.yaml) — which serves as both the public document and the Python toolchain input (datamodel-code-generator supports 3.1).

**datamodel-code-generator** (pinned via [`scripts/generate-py-models.sh`](../../apps/web/scripts/generate-py-models.sh)) then emits the Pydantic v2 models in [`api/_lib/countmein/contracts/models_gen.py`](../../apps/web/api/_lib/countmein/contracts/models_gen.py), and request validation runs against the spec's constraints. Hand-written Python lives around the generated code: decode entry points and refinements in [`api/_lib/countmein/validation`](../../apps/web/api/_lib/countmein/validation), domain logic in [`domain.py`](../../apps/web/api/_lib/countmein/contracts/domain.py), constants in [`constants_gen.py`](../../apps/web/api/_lib/countmein/contracts/constants_gen.py) (rendered by [`generate-constants.ts`](../../apps/web/scripts/generate-constants.ts)).

CI verifies freshness with `git diff --exit-code` — a schema change that wasn't regenerated shows up as a diff.

## The wire registry

[`src/wire.ts`](src/wire.ts) is the payload manifest. Every wire schema is registered under its OpenAPI id:

```ts
register(createBookingInput, { id: 'CreateBookingInput' })
```

Component schemas are emitted sorted by byte order (deterministic across machines — see `byBytes` in [`src/openapi.ts`](src/openapi.ts)), not in registration order. Schemas that never appear as HTTP bodies (Redis/QStash payloads marked `x-internal`) are still registered — they document the shape even where the codegen emits no model (those live hand-written in [`payloads.py`](../../apps/web/api/_lib/countmein/contracts/payloads.py)).

### The route manifest

[`src/routes.ts`](src/routes.ts) is the HTTP-surface manifest (not re-exported from `index.ts`). Every operation is a data record: method, path, auth, request schema (by identity), responses, and — for the three partial-update endpoints — `requestContentType: 'application/merge-patch+json'` (RFC 7386: absent key = keep, explicit `null` = clear).

Invariants, pinned by [`src/routes.test.ts`](src/routes.test.ts):

- operation ids are unique
- method+path pairs are unique
- every referenced schema is registered in `wire.ts`
- a rate-limited route documents 429
- `sessionWritable` documents 403 and never 401 (ADR-010)

The route set is pinned to the spec by tests ([`tests_py/test_route_set.py`](../../apps/web/tests_py/test_route_set.py) plus the bidirectional oasdiff contract check), so spec ↔ handler drift is a CI failure, not a silent 404.

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
- [`errors.ts`](src/errors.ts) — error bodies (`ErrorBody`, `InvalidBody`, `ValidationErrors`).
- [`records.ts`](src/records.ts) — non-entity read models inside envelopes (sitemap entries, analytics, `InternalOrganizerRecord`).
- [`merge-patch.ts`](src/merge-patch.ts) — `optionalFields`/`nullableFields`: one clearable-field table per entity feeds both the create (`optional`) and merge-patch update (`nullable` + `.partial()`) wire schemas.
- [`i18n.ts`](src/i18n.ts) — supported locales, `matchLocale`.
- [`demo.ts`](src/demo.ts) — demo organizer id/slug/constants.

### Shared domain logic

Rules that are **isomorphic** — the public page, the cabinet, and the notification worker must all agree — live here, not in `apps/web`:

- [`time-slot.ts`](src/time-slot.ts) — [`seatsLeft()`](src/time-slot.ts:123), [`fillLabel()`](src/time-slot.ts:137), [`slotEnd()`](src/time-slot.ts:165), [`slotPrice()`](src/time-slot.ts:175).
- [`service.ts`](src/service.ts) — [`effectiveLocation()`](src/service.ts:151), [`effectiveContact()`](src/service.ts:159) (service overrides organizer).
- [`options.ts`](src/options.ts) — `optionsList` / `uniqueOptionLabels()` / `selectedOptionsShape`. Checking a booking's options against a concrete service is API-side (`validate_selected_options`, pinned by the domain vectors).
- [`timezone.ts`](src/timezone.ts) — [`wallClockToInstant()`](src/timezone.ts:91), [`parseWallClockInputs()`](src/timezone.ts:113), [`instantToWallClockInputs()`](src/timezone.ts:125) (wall-clock ↔ instant for a named zone).
- [`jobs.ts`](src/jobs.ts) — `JOB_QUEUES`: every queue name mapped to its payload schema (or `null` for the empty-body schedules).
- [`demo.ts`](src/demo.ts) — [`isDemoOrganizerId()`](src/demo.ts:48).

### Form schemas (`*-form.ts`)

Form schemas are **not** wire schemas. A controlled input holds a `string` (including `''` mid-edit), while the API takes numbers and `null`. Each entity has a `*-form.ts` beside its wire schema, built with shared adapters from [`form-fields.ts`](src/form-fields.ts):

- [`optionalText()`](src/form-fields.ts:13) — `''` → `null`.
- [`numericText()`](src/form-fields.ts:21) — string → number, rejecting empty as "required" instead of coercing to `0`.

Form schemas are excluded from the wire registry (listed in `TS_ONLY` in [`wire.test.ts`](src/wire.test.ts)) so they stay out of the client bundle's codegen path.

## Testing & parity

Two mechanisms keep TypeScript and the API in lockstep:

### Shared vectors ([`vectors/`](vectors))

Single JSON test sets, run by **both** vitest and pytest:

- [`vectors/validation/`](vectors/validation) — one file per input/update schema. Each case carries a body and the expected `valid`, `fieldErrors` keys, and `formErrors` count. Comparison is structural, never message text (the API deliberately deviates on messages like `"Required"`).
- [`vectors/domain/`](vectors/domain) — one file per domain function (`seatsLeft`, `slotPrice`, `matchLocale`, `effectiveLocation`, …). Rules with no TS callsite left (`can_cancel_booking`, `hash_manage_token`, `cancel_notification_recipient`, `validate_selected_options`) keep their corpus in [`apps/web/tests_py/vectors/domain/`](../../apps/web/tests_py/vectors/domain), run by pytest alone — the Python side is the one that enforces them.

A coverage test in [`vectors.test.ts`](src/vectors.test.ts) fails if any input/update schema lacks a vector file, a valid case, or per-field error cases.

### Golden samples

Golden JSON per record lives in [`apps/web/tests_py/contracts/golden/`](../../apps/web/tests_py/contracts/golden) (frozen from the retired implementation). Vitest parses each with its Zod schema, proving a marshalled API record is valid on the TS side (the response direction); pytest re-renders each sample and byte-compares. A missing golden for any record fails `test_golden_coverage`.

### Tripwires

- [`wire.test.ts`](src/wire.test.ts) — every Zod export is registered or listed in `TS_ONLY`; ids are unique; update schemas accept `{}` (merge-patch no-op).
- [`routes.test.ts`](src/routes.test.ts) — unique operation ids and method+path pairs; every referenced schema is registered; rate-limited routes document 429; `sessionWritable` documents 403 and never 401.

## Adding a schema

Three steps (from [ADR-014](../../docs/decisions/014-contracts-wire-registry.md), [ADR-015](../../docs/decisions/015-api-route-manifest.md), [ADR-016](../../docs/decisions/016-standard-openapi-codegen.md)):

1. **Build it from registered primitives and `register()` it in [`wire.ts`](src/wire.ts).** Forgetting fails the completeness test in [`wire.test.ts`](src/wire.test.ts). If the API needs a hand-written refinement, add it in [`apps/web/api/_lib/countmein/validation/refine.py`](../../apps/web/api/_lib/countmein/validation/refine.py) and call it from the matching decode entry point in [`validation/decode/`](../../apps/web/api/_lib/countmein/validation/decode).
2. **Regenerate:** `bun run generate:py` (from `apps/web`; runs generate:i18n:py + generate:openapi + generate:constants + generate-py-models.sh). Then add a validation vector in [`vectors/validation/{Id}.json`](vectors/validation) (else the coverage test is red), and for records a golden sample in [`apps/web/tests_py/contracts/golden/{Id}.json`](../../apps/web/tests_py/contracts/golden) (else `test_golden_coverage` is red).
3. **If it crosses the wire, add the operation to [`src/routes.ts`](src/routes.ts)** — the generated router and spec derive from it, so a schema without a route is an orphan.

## Scripts

```sh
bun run test               # vitest (this package)
bun run generate:py        # i18n copy + OpenAPI spec + constants + Pydantic models (run from apps/web)
```

The generators are defined in [`apps/web`](../../apps/web/package.json) and orchestrated by Turborepo from the repo root. `generate-openapi.ts` computes all artifacts before writing any, so a failure leaves the tree untouched.
