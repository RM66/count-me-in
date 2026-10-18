# ADR-003: No WebSocket in MVP

- **Status:** Superseded by [ADR-025](025-realtime-occupancy.md) — occupancy counters are now pushed over SSE (Upstash Realtime); the atomic-UPDATE correctness rule below still stands unchanged.
- **Date:** 2026-07-18

## Context

Multiple guests may book the same slot. Live updating remaining capacity is nice-to-have, but correctness of overbooking prevention is mandatory.

## Decision

**Do not use WebSockets (or SSE) in MVP.**

- Enforce capacity with atomic SQL (`UPDATE … WHERE booked_count + :seats <= capacity RETURNING *`) inside a transaction.
- After a successful booking, invalidate TanStack Query caches; optional light polling is acceptable if UX needs fresher counts.

Revisit realtime when concurrent demand makes stale UI a real product problem ([roadmap](../roadmap.md) phase 2).

## Consequences

- Smaller infra and operational footprint.
- Guests may briefly see stale “seats left”; the server still rejects overbook.
- Organizer dashboard is not live-pushed; refresh/invalidation is enough for early usage.
