# ADR-016: Standard OpenAPI codegen (Zod → OpenAPI → Go)

- **Status:** Accepted
- **Date:** 2026-09-20
- **Supersedes:** [ADR-014](014-contracts-wire-registry.md), [ADR-015](015-api-route-manifest.md)
- **Partially relaxes:** ADR-013's "net/http only, no frameworks" rule — Go **library** dependencies are added (`kin-openapi`, `oapi-codegen/runtime`, `evanphx/json-patch`); the router stays std `net/http`
- **Plan:** [docs/contracts-standard-codegen-migration.md](../contracts-standard-codegen-migration.md)

## Context

The contracts pipeline is correct and test-covered, but it is hand-rolled: [`generate-contracts.ts`](../../apps/web/scripts/generate-contracts.ts) (~1480 lines) emits [`contracts_gen.go`](../../apps/web/pkg/contracts/contracts_gen.go) and [`validation_gen.go`](../../apps/web/pkg/validation/validation_gen.go) (~700 lines of generated parsers), plus ~420 lines of error helpers ([`errors.go`](../../apps/web/pkg/validation/errors.go)). Every new contributor pays the boilerplate cost, and the generator's fail-loud guards (D10/D11) are bespoke machinery that must be understood before any schema change.

The SSOT requirement does not change: [`packages/contracts`](../../packages/contracts) (Zod) stays the single source of truth, and the TS client ([`api-client`](../../apps/web/src/api-client)) already consumes Zod directly via `safeParse` — the best client for a "Zod-as-SSOT" setup, so client-side codegen is unnecessary. What is missing is a recognized industry pipeline for the **Go** side.

## Decision

Replace the custom generator with standard tools; the flow is single and unidirectional: **Zod → OpenAPI → Go**.

1. **Zod → OpenAPI 3.1** via [`zod-openapi`](https://github.com/asteasolutions/zod-openapi) (native Zod v4 support). A new `packages/contracts/src/openapi.ts` holds an `OpenAPIRegistry`: every wire schema registers as a component (same ids as today — `CreateBookingInput`, `ServiceRecord`, …), and paths register via `registerPath(...)` with data ported 1:1 from `routes.ts` (auth → `security`, rateLimit → `x-rateLimit`, `INTERNAL_RECORDS` → `x-internal`). Overrides that live in the generator today move into schema declarations (`.openapi({ format: 'date-time' })`, `.openapi({ pattern })`). A ~150-line script `apps/web/scripts/generate-openapi.ts` renders the registry to [`apps/web/openapi.yaml`](../../apps/web/openapi.yaml) (committed; freshness-checked in CI via `git diff --exit-code`, as today).
2. **OpenAPI → Go** via [`oapi-codegen`](https://github.com/oapi-codegen/oapi-codegen) v2 (`std-http` + strict server + models + embedded spec), driven by a YAML config — no custom code. Output: `types_gen.go`, `server_gen.go` (`StrictServerInterface` + std `net/http` router), `spec_gen.go` (`go:embed`).
3. **Runtime validation** via [`kin-openapi`](https://github.com/getkin/kin-openapi) (`openapi3filter`) + [`oapi-codegen/runtime`](https://github.com/oapi-codegen/runtime): `BindValidatableRequest` validates body/params against the embedded spec. Auth stays in `httpx` (order unchanged: QStash signature → session → body validation). One error adapter (~120 lines, `error_adapter.go`) maps `*openapi3.SchemaError` / `*openapi3filter.RequestError` to the existing envelope `{error: 'Validation error', issues: {<path>: [<message>]}}` — one mapper instead of 14 generated parsers.
4. **Partial updates** via JSON Merge Patch ([RFC 7386](https://datatracker.ietf.org/doc/html/rfc7386), [`evanphx/json-patch`](https://github.com/evanphx/json-patch)) for `UpdateServiceInput`, `UpdateTimeSlotInput`, `UpdateOrganizerProfileInput` (`Content-Type: application/merge-patch+json`). "Absent = keep, null = clear" comes from RFC 7386 itself; bounds are applied to the **final** state — semantically stricter than today (currently the patch is validated, not the result).
5. **Hand-written code remains** (ordinary, testable, no `*_gen.go` magic): `rules.go` / `refine.go` / `domain.go` (business rules inexpressible in OpenAPI — reserved slugs, uniqueness, slot-in-past, seatsLeft), `mergepatch.go`, a manual `FlexTime.UnmarshalJSON` (~40 lines, `oneOf date-time | epoch`), and a constants mini-generator (~80 lines, `constants_gen.go`) — the only codegen remnant.

### Implementation notes (deviations from the text above)

The shipped pipeline differs from the decision text in three places; the code is the reference, this list exists so the two do not drift:

1. **`createDocument`, not `OpenAPIRegistry`/`registerPath`.** `openapi.ts` passes `WIRE_SCHEMAS` as `components.schemas` and builds `paths` from `routes.ts` by hand (`buildPaths()`), with `outputIdSuffix: ''` so input/output renders share one component. `routes.ts` remains the HTTP manifest; zod-openapi renders it.
2. **Validation is per-property, not `BindValidatableRequest` in a middleware.** `pkg/validation/spec.go` loads the embedded spec once (`sync.Once`) and validates each present top-level property with `Schema.VisitJSON` — that is what preserves one message per field (the old `z.flattenError` parity). There is no `pkg/api/middleware.go` and no `error_adapter.go`; `Decode*` in `pkg/validation/decode.go` is the single entry point, and the cold-start TODO with the `ogen` fallback lives in `spec.go`.
3. **One spec, 3.1, everywhere** (collapsed 2026-09-21, when [oapi-codegen v2.8.0](https://github.com/oapi-codegen/oapi-codegen/releases/tag/v2.8.0) added OpenAPI 3.1 support). During Phase 2–5 two specs were committed — `apps/web/openapi.yaml` (3.1, public) and `apps/web/pkg/api/gen/openapi.yaml` (3.0.3, Go toolchain) — because oapi-codegen could not consume 3.1 (upstream issue #373). Now `generate-openapi.ts` renders one 3.1 document, committed at `apps/web/openapi.yaml`; `go generate` reads it via a relative path (`pkg/api/gen/doc.go`) and oapi-codegen embeds it into `spec_gen.go`. The `version` switch in `buildOpenApiDocument` and the second spec file are gone.

### Accepted trade-offs

- **No Zod↔Go message parity.** kin-openapi phrases errors differently than Zod ("minimum must be 1" vs "Too small: expected number to be >=1"). Impact is low: the client shows localized generic messages (`ApiErrors`); `issues` in responses go to logs/devtools; vectors pin error **keys**, not text (the structural-comparison rule from ADR-014 is preserved). If message parity ever becomes a requirement, it is a stop-factor restorable only with a custom generator.
- **Runtime validation instead of generated parsers.** kin-openapi parses the embedded spec at function initialization (tens of ms on a cold start of the Vercel Go runtime). Mitigations: measure in Phase 3; switch to `ogen` (static validation) or validate only write methods if significant.
- **Merge-patch changes the wire format of three update endpoints** (`Content-Type` + semantics). The monorepo deploys as a single Vercel project, so client and API ship together — the risk is bounded by the deploy window.
- **Loss of fail-loud guards** (the old generator failed when it could not infer a rule; oapi-codegen silently generates `any` for schemas it does not understand). Compensation: optional `openapi-typescript` type-conformance tests, vectors, goldens, and review of generated types.

## Consequences

- **Adding a schema** shrinks from six steps to three: Zod → `openapi.ts` → `bun run generate:openapi && go generate` (+ the validation vector, which stays).
- `manifest_test.go` and the `check:api-routes` script are removed: the router is generated from the spec, so mux↔manifest divergence is impossible by construction. What the generated mux cannot see is `vercel.json`: a rewrite per top-level `/api/...` prefix is still required, pinned by `pkg/api/vercel_test.go` (which drives the rewrite patterns from the committed spec).
- The old pipeline runs in parallel until Phase 6 of the plan; then `generate-contracts.ts`, `contracts_gen.go`, `validation_gen.go`, `errors.go`, the kinds registry and `x-go-*` metadata in `wire.ts`, `Optional[T]`, and `manifest_test.go` are deleted. Success metric: `git grep -l 'x-go-'` is empty.
- Custom code after the migration is ~300–500 lines of ordinary application Go (adapters, handlers) instead of ~1480 lines of generator + ~700 lines of generated parsers + ~420 lines of helpers.
- Cold start of the Go function must stay within +50 ms of the current value (measured in Phase 3); otherwise plan B is `ogen`.
- Rejected alternatives (ConnectRPC/Buf, Fern/Speakeasy/Stainless, `ogen` as primary, `quicktype`, status quo) are analyzed in the [plan](../contracts-standard-codegen-migration.md).
