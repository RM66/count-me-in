# ADR-015: API route manifest (`packages/contracts/src/routes.ts`)

- **Status:** Superseded by [ADR-016](016-standard-openapi-codegen.md) (2026-09-20)
- **Date:** 2026-09-18
- **Amends:** [ADR-014](014-contracts-wire-registry.md)

## Summary

Added the HTTP surface to the contract: `packages/contracts/src/routes.ts` became the route manifest (method, path, auth, request/response schemas referenced by identity), from which OpenAPI `paths` and the Go route table both derive — closing the gap where four GET endpoints existed in the mux but not in the spec. Two rules from here are still load-bearing: **shape vs policy primitives are separate** (`slugShape` describes a stored value; `slug` adds registration policy — a response DTO must never fail its own schema because of a request-only constraint), and **orphan schemas fail** (a registered schema reachable from no operation and not in `INTERNAL_RECORDS` is an error).

**Superseded (ADR-016):** the mux-parity test and the `check:api-routes` script this ADR introduced were replaced by construction — the router is now generated from the spec by oapi-codegen, so spec↔handler drift is a compile error, and `vercel_test.go` pins the `vercel.json` rewrites. `routes.ts` itself remains the HTTP manifest that zod-openapi renders into both committed specs.
