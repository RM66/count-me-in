import { defineConfig } from '@playwright/test'

/**
 * E2E smoke: exactly three scenarios,
 * no more — guest booking round-trip, cabinet create flow, demo read-only.
 *
 * The suite runs against the dev topology: `next dev` on :3000 with the Go
 * API (`cmd/dev`) on :3001, next.config.js rewrites proxying `/api/*` there —
 * the same dispatch as production (ADR-013). Requires the docker-compose
 * Postgres + Redis and a migrated schema.
 */

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // the scenarios share one database — no parallel writes
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    launchOptions: {
      // Corporate/system proxies break the dev-server HMR websocket and with
      // it React hydration — never route localhost through a proxy.
      args: ['--no-proxy-server'],
    },
  },
  webServer: [
    {
      command: 'go run ./cmd/dev',
      url: 'http://127.0.0.1:3001/api/healthz',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        // The scenarios create real bookings. With a populated local .env the
        // Go API would publish them to the real QStash; point the publisher at
        // an unreachable local address instead — the publish failure is
        // absorbed (ADR-012) and the outbox rows simply stay pending. A dev
        // server started by hand (reuseExistingServer) keeps its own env.
        QSTASH_URL: 'http://127.0.0.1:1',
      },
    },
    {
      command: 'bun run dev:web',
      url: 'http://127.0.0.1:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
})
