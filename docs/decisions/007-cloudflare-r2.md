# ADR-007: Media storage on Cloudflare R2 (not UploadThing)

- **Status:** Accepted
- **Date:** 2026-07-19

## Context

Organizers upload an avatar and service photos. Candidates: **Cloudflare R2** vs **UploadThing**.

|            | Cloudflare R2                                     | UploadThing                    |
| ---------- | ------------------------------------------------- | ------------------------------ |
| API        | S3-compatible; DIY signed URLs                    | Opinionated Next.js-centric DX |
| Clients    | Any HTTP client (web cabinet, later native)       | Best with Next server routes   |
| Cost       | No egress fees; predictable                       | Usage on UploadThing’s SaaS    |
| Lock-in    | Object storage (portable)                         | Product + SDK lock-in          |
| Domain fit | Natural with Cloudflare DNS for `countmein.group` | Independent                    |

## Decision

Store media in **Cloudflare R2**.

- Expose helpers in `packages/storage` (create signed PUT URL, public URL / CDN mapping, key layout e.g. `organizers/{id}/avatar`, `services/{id}/photo`).
- API in `apps/web` issues short-lived upload credentials only to authenticated organizers; clients upload **directly to R2**.
- Persist only the resulting URL on `Organizer.photoUrl` / `Service.photoUrl`.

**Do not** use UploadThing for MVP — R2 keeps storage portable and avoids SaaS lock-in; signed PUTs work the same if a Capacitor client appears later.

## Consequences

- Slightly more setup (bucket, CORS, token permissions) than UploadThing.
- Same upload path for web and native shells.
- Optional Cloudflare Images / Worker later for resizing — out of MVP.
