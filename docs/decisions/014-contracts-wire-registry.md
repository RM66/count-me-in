# ADR-014: Contracts wire registry (`packages/contracts/src/wire.ts`)

- **Status:** Accepted
- **Date:** 2026-09-18
- **Amends:** ADR-013 §3 ("guard, don't derive" → derive from a registry; guards remain for what cannot be derived)

## Context

`packages/contracts` is the declared single source of truth for the TS↔Go wire contract, but the generator only emitted what was manually listed in its own tables (`inputStructs`, `recordStructs`, `GO_ENUM_TYPES`, `assertParserConformance` inputs, `exportedSchemas`, `REQUEST_SCHEMAS`). A new `z.object` in `packages/contracts/src/` generated no diff, and CI (`git diff --exit-code`) stayed green — silent drift. Related holes:

1. `Parse*` bodies were hand-written Go inside a TS template literal, while `DO NOT EDIT` files carried hand-written logic (`SeatsLeft`, `MatchLocale`, `ValidateSelectedOptions`, `CreateBookingData`).
2. The response direction was unchecked: the TS client cast responses (`as ErrorBody & T`), and no test proved a marshalled Go record parses under its Zod schema.
3. Envelopes were `map[string]any` in Go, inline generics in TS, and hand-written OpenAPI paths; `openapi.yaml` described 400 as `{formErrors, fieldErrors}` while Go sent `{error, details: {…}}`, with a second `{error, issues}` variant undescribed.
4. The generator read private Zod internals (`_zod.def`, `~standard.jsonSchema.input()`).
5. Parity vectors were hand-duplicated across Go tests and TS tests.

## Decision

- **D1 — Manifest.** The manifest is a Zod registry `wire` (`z.registry<WireMeta>()`) in `packages/contracts/src/wire.ts`, plus a `TS_ONLY` list and a completeness test. Every wire schema registers with its Go name and kind; forgetting is a red test naming the export. Kinds: `primitive` (named scalar/array schema → `$defs`/`$ref` + `{Id}Rule`), `enum` (`z.enum` → named Go type or `string`), `input` (create/action bodies; required or optional), `update` (PATCH/PUT bodies, all optional; absent = keep, null = clear), `record` (what Go returns: DTOs, envelopes, Redis/QStash payloads — marshalled, never parsed, by Go). Registration order is emission order (D12).
- **D2 — Public API only.** The generator consumes one `z.toJSONSchema(wire, { io: 'input', unrepresentable: 'any', uri })` call. Go types and rules resolve by `$ref` name; nothing reads Zod internals.
- **D3 — Residue is ordinary code.** `.refine/.transform` and domain logic cannot cross the language boundary, so they live hand-written in `pkg/contracts/domain.go`, `pkg/contracts/data.go`, `pkg/validation/rules.go`, `pkg/validation/refine.go`. The generator emits only calls (`refine{Id}(e, &out)`) and fails when a callee is missing.
- **D4 — Shared vectors.** Validation and domain vectors are single JSON sets under `packages/contracts/vectors/`, run by vitest and `go test`. Comparison is structural (`valid`, sorted `fieldErrors` keys, `formErrors` count) — never message text, where Go deliberately deviates (`"Required"`).
- **D5 — Response direction via goldens.** Go writes golden JSON per record; vitest parses each with its Zod schema (stage 5).
- **D6 — Typed envelopes.** Envelopes are Zod schemas (kind `record`); Go answers with typed structs; OpenAPI responses reference them (stage 5).
- **D7 — Client parses, never casts.** `api-client` wraps every call in `safeParse`; a mismatch logs in dev, throws in test, and reports to Sentry in prod — signal without a white screen (stage 5).
- **D8–D9 — Safe refactor proof.** The template was normalized to canonical form first (stage 3), so the mechanism swap (stage 4) is byte-identical on both generated Go files; Go validation messages are frozen templates generated from JSON Schema constraints.
- **D10 — Derivable line.** The generator derives rules only from `minLength`/`maxLength`, `minimum`/`maximum`, `enum`. `format`, `pattern`, transforms and refinements require `x-go-rule` (generation fails without it).
- **D11 — Named fields.** Every `input`/`update` field is a `$ref` to a registered primitive/enum (or an array of one); inline schemas are records-only. Rule names are deterministic (`{Id}Rule`); inline input fields fail generation.
- **D12 — Registration order is emission order.** Go structs, rules and parsers emit in `wire.ts` registration order; `components.schemas` in OpenAPI is byte-sorted by id instead, so it never depends on that order.
- **D13 — Scope.** This ADR amends ADR-013 §3; anything beyond needs its own ADR (per AGENTS.md).

## Consequences

- **Adding a schema** is five steps: export the `z.object` from registered primitives (else the generator fails, D11); `register()` it in `wire.ts` (else `wire.test.ts` is red); run `generate:contracts` (a named `x-go-refine` without its function fails); add a validation vector file (else the coverage test is red); for records, add a golden sample (else `TestGoldenCoverage` is red).
- **What is hand-written and where:** `domain.go` (locale/seat/price/option/contact/login-key/demo predicates), `data.go` (`CreateBookingData`), `rules.go` (char length, int ranges, UUID/service/slug/timezone/URL rules, slot-start check), `refine.go` (six input refinements). Guarded by existence checks, vectors, and goldens.
- **What the generator derives:** constants, enum types + consts, `Locales`, structs, `RecordNames`, patterns/reserved sets, length/int/enum rules, `Parse*` + `{k}OrDefault` + `Parsers`, and `openapi.yaml` components (sorted by id, `x-go-*` stripped, `Slug.pattern` patched in and `SlotStartsAt` replaced by its documented wire shape after rendering).
- **Known, documented divergences:** Go `FlexTime` rejects date-only strings that `z.coerce.date()` accepts (pinned by `skip.go` vector cases); `z.url()` trims surrounding whitespace at runtime while Go's `URLRule` validates the value verbatim, so a padded URL is accepted client-side and rejected with 400 server-side (unpinned, pre-existing — the `x-go-trim` tripwire tracks explicit `.trim()` only).
- **Upgrade risk:** a Zod upgrade that changes JSON Schema output shows up as a generator diff; vectors and goldens show whether behaviour changed.
