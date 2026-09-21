# ADR-014: Contracts wire registry (`packages/contracts/src/wire.ts`)

- **Status:** Superseded by [ADR-016](016-standard-openapi-codegen.md) (2026-09-20)
- **Date:** 2026-09-18
- **Amended by:** [ADR-015](015-api-route-manifest.md)

## Summary

Made `packages/contracts` the enforced single source of truth for the TS↔Go wire contract via a Zod registry (`wire.ts`): every wire schema registers with its Go name and kind (primitive/enum/input/update/record), a hand-written generator (`generate-contracts.ts`, ~1480 lines) derives Go structs, rules and `Parse*` parsers from one `z.toJSONSchema(wire)` call, and parity is pinned by shared JSON vectors (run by both vitest and `go test`) plus golden response samples parsed on both sides. Key rules that survive today: inputs are built from registered primitives (no inline fields), comparison is structural (error keys, never message text), and a response must never fail its own schema.

**Superseded (ADR-016):** the hand-rolled generator and its fail-loud guards (D10/D11) were bespoke machinery every contributor had to understand before any schema change. ADR-016 replaced the generator with standard tooling — zod-openapi renders the OpenAPI specs, oapi-codegen generates the Go router/types/embedded spec, kin-openapi validates requests — keeping the same registry, vectors, goldens and invariants. The wire registry itself (`wire.ts`) and the route manifest (ADR-015) remain the manifests; only the codegen mechanism changed.
