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
- **Downscale in the browser before upload** (see amendment below).

**Do not** use UploadThing for MVP — R2 keeps storage portable and avoids SaaS lock-in; signed PUTs work the same if a Capacitor client appears later.

## Amendment (2026-07-30): browser-side downscaling

Originally all resizing was deferred past MVP. Raw phone photos are 3–5 MB, and
because superseded objects are never deleted, storage grows per _upload_ rather
than per organizer — roughly 2 000 uploads would exhaust a 10 GB bucket.

**The client now downscales before requesting the signed URL:** center-crop to a
square, longest edge 512 px, re-encoded as WebP (quality 0.85). That lands at
~30–60 KB — a 50–100× reduction — pushing the same bucket past ~200 000 uploads
and making object cleanup unnecessary for the foreseeable future.

Implemented in `apps/web/lib/helpers/image.ts` via `createImageBitmap` +
`OffscreenCanvas`; constants live in `packages/api-contracts` (`storage.ts`) so
client and server agree. Resizing must happen **before** the signed URL is
issued, since the signature commits to an exact `Content-Type` and
`Content-Length`.

Two size limits, deliberately distinct:

| Constant                  | Applies to                    | Value |
| ------------------------- | ----------------------------- | ----- |
| `AVATAR_MAX_BYTES`        | source file the user picks    | 5 MB  |
| `AVATAR_UPLOAD_MAX_BYTES` | resized payload the API signs | 1 MB  |

Still **out of MVP**: server-side (`sharp`) resizing, which would contradict the
direct-to-R2 upload path, and Cloudflare Images / Worker CDN variants. On the
read path `next/image` already serves optimised renditions.

## Consequences

- Slightly more setup (bucket, CORS, token permissions) than UploadThing.
- Same upload path for web and native shells.
- Stored avatars are capped at 512×512 WebP; the original resolution is not kept.
  Acceptable for avatars — revisit if service photos need larger variants.
- A future Capacitor client must replicate the downscaling step (or the API must
  gain a server-side path) — the browser helper is web-only.
- Optional Cloudflare Images / Worker later for CDN variants — out of MVP.
