# CountMeIn

Online booking for group events — `https://countmein.group`

Organizers publish services with time slots and capacity; guests book on a public page; organizers manage a web cabinet opened from messenger notification links.

## Target audience

Organizers of group classes, events, and outings who need to manage schedule, capacity, and bookings without endless chats and spreadsheets.

- **Sport & active recreation** — group training, team sports, dance, martial arts, running/cycling/climbing clubs, SUP/kayak/surf/ski.
- **Wellness & practices** — meditation, breathwork, sound healing, bath ceremonies, retreats, support groups.
- **Learning & creativity** — masterclasses, courses, workshops, art/ceramics/photography, cooking, music, language clubs.
- **Entertainment & communities** — quizzes, mafia, board/RPG games, book/film clubs, networking, speed dating, kids' events, expat communities.
- **Excursions & outings** — city walks, food tours, hiking, camping, diving, fishing, yachting, wine/foraging/gastro tours.
- **Animals** — group sessions with a cynologist, dog socialization, training, horseback, pet-friendly events.
- **Beauty & professional services** — group beauty procedures, makeup/styling lessons, group consultations, coworking sessions, mastermind groups.

## Apps

| App        | Role                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------ |
| `apps/web` | Landing, public booking, organizer cabinet, Python API + job handlers (Next.js + Python, one Vercel project) |

## Packages

| Package                   | Role                                                  |
| ------------------------- | ----------------------------------------------------- |
| `@repo/db`                | Drizzle schema & migrations                           |
| `@repo/contracts`         | Shared Zod schemas, wire registry, API route manifest |
| `@repo/translations`      | Web + notification copy (ICU messages per locale)     |
| `@repo/eslint-config`     | ESLint configs                                        |
| `@repo/typescript-config` | TypeScript configs                                    |

## Stack

- **Runtime / monorepo:** Bun, Turborepo
- **App:** Next.js (`apps/web`)
- **API:** Python 3.12, FastAPI (ASGI) — a single Vercel Function ([ADR-021](docs/decisions/021-api-python-rewrite.md))
- **UI:** React, Tailwind, shadcn/ui (Radix)
- **State:** TanStack Query (server)
- **Auth:** Auth.js — messenger login only (Telegram Login Widget)
- **Validation:** Zod (`packages/contracts`) → OpenAPI → Pydantic v2 models via datamodel-code-generator; requests validated against the spec ([ADR-016](docs/decisions/016-standard-openapi-codegen.md), [ADR-021](docs/decisions/021-api-python-rewrite.md))
- **i18n:** next-intl, ICU messages per locale ([ADR-011](docs/decisions/011-i18n.md))
- **Data:** Postgres, Drizzle ORM, Redis
- **Media:** Cloudflare R2
- **Jobs:** Upstash QStash ([ADR-012](docs/decisions/012-queue-upstash-qstash.md))
- **Notifications:** messengers primary (Telegram first); cabinet deep links
- **Observability:** PostHog, Sentry

Architecture and domain: [`docs/`](docs/), agent guide: [`AGENTS.md`](AGENTS.md).

## Develop

```sh
bun install
cp .env.example .env          # DB + Redis connection strings
docker compose up -d          # Postgres + Redis
bun run --filter @repo/db db:migrate   # apply migrations
bun run dev
```

Package manager: **Bun** (see `.vscode/settings.json`); Python toolchain managed by **uv** — run `uv sync` in `apps/web` once after cloning (the local API dev server is uvicorn via `bun run dev:api:py`).

### Database

Drizzle schema and migrations in [`packages/db`](packages/db):

```sh
bun run --filter @repo/db db:generate   # create a migration from schema changes
bun run --filter @repo/db db:migrate    # apply pending migrations
bun run --filter @repo/db db:studio     # open Drizzle Studio
```

### Contracts codegen

`bun run generate:py` renders everything derivable: `generate:i18n:py` (ICU messages → `i18n/translations_gen.py`), `generate:openapi` (Zod wire registry → `openapi.yaml` via zod-openapi), `generate:constants` (→ `contracts/constants_gen.py`) and `scripts/generate-py-models.sh` (datamodel-code-generator → `contracts/models_gen.py`). The route set is pinned to the spec by tests; request validation runs against the spec's constraints ([ADR-014](docs/decisions/014-contracts-wire-registry.md), [ADR-015](docs/decisions/015-api-route-manifest.md), [ADR-016](docs/decisions/016-standard-openapi-codegen.md), [ADR-021](docs/decisions/021-api-python-rewrite.md)). Never edit `*_gen.py` by hand.

### Demo organizer

A read-only demo organizer is seeded at `/demo`. All write paths reject it; notifications are never sent for it; the seed refreshes daily via a QStash schedule. See [ADR-010](docs/decisions/010-demo-organizer-account.md).

### Testing

TS tests are co-located beside source (`*.test.ts` / `*.test.tsx`); the Python API suite lives in `apps/web/tests_py/` (**pytest**).

```sh
bun run test          # all packages (Turborepo: Vitest; apps/web runs test:web only)
bun run test:py       # the Python API suite (pytest) — a separate, mandatory command
bun run test:watch    # watch mode (vitest)
```

In `apps/web`: `bun run test:web` (Vitest) or `bun run test:py` (pytest).

Coverage spans Zod schemas and slot/timezone logic (`packages/contracts`), helpers, API client, React hooks and components, and the Python API (`apps/web/api/_lib` + `tests_py`).

## Key conventions

- **Messenger-only identity** — no phone/OTP ([ADR-008](docs/decisions/008-messenger-only-auth.md)).
- **Guest booking** without Auth.js accounts; cancel in MVP ([ADR-002](docs/decisions/002-guest-booking.md)).
- **Atomic capacity** — single conditional `UPDATE` inside booking transaction, never read-then-write.
- **Prices are display text only** in MVP (no payments).
- **`/cabinet` requires no session** — anonymous visitors see read-only demo ([ADR-010](docs/decisions/010-demo-organizer-account.md)).
- **Notifications published after commit** — jobs carry ids only; the handler refetches at send time ([ADR-012](docs/decisions/012-queue-upstash-qstash.md)).
- **Organizer deep links** are one-time login links consumed via `POST`.
- **i18n** — locale from cookie / `Accept-Language`, never in URL; no hardcoded user-visible strings ([ADR-011](docs/decisions/011-i18n.md)).

See [`AGENTS.md`](AGENTS.md) for full conventions and monorepo layout.
