# CountMeIn

Online booking for group events — `https://countmein.group`

## Apps

| App | Role |
|-----|------|
| `apps/web` | Landing, public booking, organizer cabinet, API (Next.js) |
| `apps/worker` | Notification / job worker (`pg-boss`) |

## Packages

| Package | Role |
|---------|------|
| `@repo/ui` | Shared UI primitives |
| `@repo/db` | Drizzle schema & client |
| `@repo/api-contracts` | Shared Zod / API types |
| `@repo/storage` | Cloudflare R2 helpers |
| `@repo/eslint-config` | ESLint configs |
| `@repo/typescript-config` | TypeScript configs |

Architecture and domain: [`docs/`](docs/), agent guide: [`AGENTS.md`](AGENTS.md).

## Develop

```sh
bun install
bun run dev
```

Package manager: **Bun** (see `.vscode/settings.json`).
