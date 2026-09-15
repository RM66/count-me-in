import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import * as schema from './schema'

const connectionString = process.env.POSTGRES_URL

if (!connectionString) {
  throw new Error('POSTGRES_URL is not set')
}

// Serverless pool protection (Phase 2.4): cap the connection count at 1 so a
// burst of serverless instances cannot exhaust the database's connection
// limit. Next.js server components read Postgres directly; a single pooled
// connection per instance is enough for that traffic, and the Go API keeps
// its own small pool for writes. `idle_timeout` recycles idle connections.
//
// In dev, the module is re-evaluated on hot reload; caching the client on
// `globalThis` keeps a single connection across reloads instead of leaking a
// new one each time.
const globalForDb = globalThis as unknown as { __countmeinDbClient?: postgres.Sql }

const client =
  globalForDb.__countmeinDbClient ?? postgres(connectionString, { max: 1, idle_timeout: 20 })
if (process.env.NODE_ENV !== 'production') {
  globalForDb.__countmeinDbClient = client
}

export const db = drizzle(client, { schema })

export { client, schema }
