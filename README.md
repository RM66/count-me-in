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

| App           | Role                                                      |
| ------------- | --------------------------------------------------------- |
| `apps/web`    | Landing, public booking, organizer cabinet, API (Next.js) |
| `apps/worker` | Notification / job worker (`pg-boss`)                     |

## Packages

| Package                   | Role                                                    |
| ------------------------- | ------------------------------------------------------- |
| `@repo/db`                | Drizzle schema & client                                 |
| `@repo/redis`             | ioredis singleton (sessions, auth tickets, rate limits) |
| `@repo/contracts`         | Shared Zod / API types                                  |
| `@repo/media-storage`     | Cloudflare R2 helpers                                   |
| `@repo/eslint-config`     | ESLint configs                                          |
| `@repo/typescript-config` | TypeScript configs                                      |

## Stack

- **Runtime / monorepo:** Bun, Turborepo
- **App:** Next.js (`apps/web`)
- **UI:** React, Tailwind, shadcn/ui (Radix)
- **State:** TanStack Query (server)
- **Auth:** Auth.js — messenger login only (Telegram Login Widget)
- **Validation:** Zod (`packages/contracts`)
- **Data:** Postgres, Drizzle ORM, Redis
- **Media:** Cloudflare R2
- **Jobs:** `pg-boss` + `apps/worker`
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

Package manager: **Bun** (see `.vscode/settings.json`).

### Database

Drizzle schema and migrations in [`packages/db`](packages/db):

```sh
bun run db:generate   # create a migration from schema changes
bun run db:migrate    # apply pending migrations
bun run db:studio     # open Drizzle Studio
```

### Demo organizer

A read-only demo organizer is seeded at `/demo`. All write paths reject it; the worker never notifies it. See [ADR-010](docs/decisions/010-demo-organizer-account.md).

### Testing

Tests use **Vitest** + **React Testing Library**, co-located beside source (`*.test.ts` / `*.test.tsx`):

```sh
bun run test          # all packages (Turborepo)
bun run test:watch    # watch mode
```

Coverage spans Zod schemas (`packages/contracts`), helpers, API client, server guards, React hooks, components (`apps/web`), and Telegram templates/client (`apps/worker`).

## Key conventions

- **Messenger-only identity** — no phone/OTP ([ADR-008](docs/decisions/008-messenger-only-auth.md)).
- **Guest booking** without Auth.js accounts; cancel in MVP ([ADR-002](docs/decisions/002-guest-booking.md)).
- **Atomic capacity** — single conditional `UPDATE` inside booking transaction, never read-then-write.
- **Prices are display text only** in MVP (no payments).
- **`/cabinet` requires no session** — anonymous visitors see read-only demo ([ADR-010](docs/decisions/010-demo-organizer-account.md)).
- **Notifications enqueued inside transaction** — jobs carry ids only; worker refetches at send time.
- **Organizer deep links** are one-time login links consumed via `POST`.

See [`AGENTS.md`](AGENTS.md) for full conventions and monorepo layout.
