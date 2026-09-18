# @repo/contracts

The single source of truth for the wire contract between the TypeScript client and the Go API.

CountMeIn has two ends of one wire: a React + React Query frontend ([`apps/web/src/api-client`](../../apps/web/src/api-client)) and a Go API ([`apps/web/api`](../../apps/web/api) + [`apps/web/pkg`](../../apps/web/pkg)). They never import each other — the contract between them is HTTP plus the Zod schemas defined **here**. This package owns those schemas, the shared domain rules both sides must agree on, and the manifest that drives cross-language code generation.

Full design rationale: [ADR-014](../../docs/decisions/014-contracts-wire-registry.md).

## How it works

Everything starts as a Zod schema in [`src/`](src). A code generator ([`apps/web/scripts/generate-contracts.ts`](../../apps/web/scripts/generate-contracts.ts), run via `bun run generate:contracts`) renders the registry through the public `z.toJSONSchema()` API and emits three artifacts:

| Artifact      | Path                                                                                           | Contents                                                    |
| ------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Go contracts  | [`apps/web/pkg/contracts/contracts_gen.go`](../../apps/web/pkg/contracts/contracts_gen.go)     | Structs, enums, constants, `RecordNames`                    |
| Go validation | [`apps/web/pkg/validation/validation_gen.go`](../../apps/web/pkg/validation/validation_gen.go) | Length/int-range/enum rules, `Parse*` bodies, `Parsers` map |
| OpenAPI 3.1   | [`openapi.yaml`](openapi.yaml)                                                                 | `components.schemas` + all API paths                        |

The generator reads **only** the public JSON Schema output — never Zod internals. Go types and rules resolve by `$ref` name. Anything the generator cannot derive (transforms, refinements, temporal checks, domain functions) lives hand-written in ordinary Go files and is called by name from the generated code; a missing callee fails generation, not the build.

CI verifies freshness with `git diff --exit-code` — a schema change that wasn't regenerated shows up as a diff.

## The wire registry

[`src/wire.ts`](src/wire.ts) is the manifest. Every wire schema is registered with its Go name and a kind:

```ts
register(createBookingInput, { id: 'CreateBookingInput', kind: 'input' })
```

The five kinds:

- **`primitive`** — a named scalar/array schema. Becomes a `$ref` and a `{Id}Rule` validation function.
- **`enum`** — a `z.enum`. Becomes a named Go type (or `string` when `x-go-type: 'string'`) with typed constants.
- **`input`** — a create/action request body. Required and optional fields; parsed by Go.
- **`update`** — a PATCH/PUT body. All fields optional: absent = keep, `null` = clear.
- **`record`** — what Go returns: DTOs, envelopes, Redis/QStash payloads. Marshalled by Go, never parsed.

Registration order is emission order for Go structs, rules, and parsers (D12). OpenAPI `components.schemas` is byte-sorted by id instead, so it never depends on that order.

### `x-go-*` metadata

The registry carries Go-specific hints that JSON Schema cannot express:

- [`x-go-rule`](src/wire.ts) — names the hand-written rule for a primitive with `format`/`pattern`/transforms (generation fails without it).
- [`x-go-refine`](src/wire.ts) — names the hand-written refinement called at the end of a parser.
- [`x-go-trim`](src/wire.ts) — marks a string primitive that trims, so the Go parser trims too.
- [`x-go-enum-consts`](src/wire.ts) — maps enum values to named Go constants (must cover every option).
- [`x-go-type`](src/wire.ts) — overrides the Go type (e.g. `FlexTime` for slot starts).
- [`x-go-skip`](src/wire.ts) — excludes a record from Go generation (e.g. Telegram widget payload, parsed by Auth.js).

## What lives where

### Wire schemas (`src/`)

One file per entity, each holding its input, update, and record schemas built from shared primitives:

- [`primitives.ts`](src/primitives.ts) — scalar building blocks (`slug`, `displayName`, `capacity`, `seats`, `uuid`, …) and their bounds (`BOUNDS`).
- [`enums.ts`](src/enums.ts) — shared enumerations (`BookingStatus`, `Messenger`, `OptionsSelectMode`).
- [`organizer.ts`](src/organizer.ts), [`service.ts`](src/service.ts), [`time-slot.ts`](src/time-slot.ts), [`booking.ts`](src/booking.ts) — entity schemas.
- [`auth.ts`](src/auth.ts) — ticket and Telegram widget schemas.
- [`storage.ts`](src/storage.ts) — image upload input/target schemas.
- [`jobs.ts`](src/jobs.ts) — QStash queue names and job payloads.
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

- [`wire.test.ts`](src/wire.test.ts) — every Zod export is registered or listed in `TS_ONLY`; ids are unique; update schemas accept `{}`; enum consts cover all options.
- [`generator-parity.test.ts`](src/generator-parity.test.ts) — every string primitive's `.trim()` matches its `x-go-trim` flag; enum option order matches `x-go-enum-consts` key order.

## Adding a schema

Five steps (from [ADR-014](../../docs/decisions/014-contracts-wire-registry.md)):

1. **Build from registered primitives.** Input/update fields must `$ref` a registered primitive or enum — inline schemas fail generation (D11). Records may use inline fields.
2. **`register()` it in [`wire.ts`](src/wire.ts).** Forgetting fails the completeness test in [`wire.test.ts`](src/wire.test.ts).
3. **Run `bun run generate:contracts`.** A named `x-go-refine` without its hand-written function in [`apps/web/pkg/validation/refine.go`](../../apps/web/pkg/validation/refine.go) fails here.
4. **Add a validation vector** in [`vectors/validation/{Id}.json`](vectors/validation) (else the coverage test is red).
5. **For records, add a golden sample** in [`apps/web/pkg/contracts/testdata/golden/{Id}.json`](../../apps/web/pkg/contracts/testdata/golden) (else `TestGoldenCoverage` is red).

## Scripts

```sh
bun run test              # vitest (this package)
bun run generate:contracts  # regenerate Go + OpenAPI artifacts (run from repo root)
```

The generator is defined in [`apps/web`](../../apps/web/package.json) and orchestrated by Turborepo from the repo root. It computes all artifacts before writing any, so a failure leaves the tree untouched.
