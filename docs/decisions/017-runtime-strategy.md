# ADR-017: Runtime strategy — one vs two runtimes

- **Status:** Superseded by [ADR-021](021-api-python-rewrite.md) (2026-09-26) — the two-runtime seam itself is gone; the API is now Python
- **Date:** 2026-09-22
- **Related:** [ADR-013](013-api-go-rewrite.md), [ADR-016](016-standard-openapi-codegen.md)
- **Origin:** consolidated architecture review (glm §6, hy4 §5, mimo §4) — "the main strategic fork post-MVP"

## Summary

Evaluated the two-runtime split (Next.js for pages/reads/Auth.js + a Go API for writes/jobs/notifications, one Vercel project) against collapsing to one runtime. The review found real costs: ~14k lines of Go duplicating the Drizzle schema with hand-written SQL/scan bindings, a second Redis client and i18n runtime, DTO mappers ×2, a demo seed ×2, no ability to invalidate Next.js caches (`revalidateTag`) from Go, and two test/observability stacks. Chose **option C — status quo + isolation**: keep the split, hold parity via pipeline discipline (contract vectors, goldens, generated router), and isolate the seam with rules (Go owns writes/jobs only; shared truth stays in `packages/contracts` + `packages/translations`; no new duplication classes). Options A (Next.js-only) and B (Go as a separate service) were pre-analyzed for the revisit triggers (team growth, drift incidents, cold-start/publish latency, a second API client, hosting costs).

**Superseded (ADR-021):** the Go runtime was replaced by Python 3.12 ASGI, resolving the fork by removing the polyglot seam entirely — one shared contract pipeline (Zod → OpenAPI → Pydantic), one test stack addition (pytest), and the pre-analyzed options A/B became moot. The full text (isolation rules, revisit triggers, backlog items) is preserved in git history.
