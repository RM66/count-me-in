// Package db is the server end of the data wire: Postgres reads and
// writes via pgx, one file per entity, DTO mapping included. Route
// handlers must not run SQL inline (AGENTS.md).
//
// Schema knowledge is duplicated across two access patterns
// (architecture review fix #10): this package hand-writes SQL with
// explicit column lists and manual Scan order, while the TS side
// (packages/db) uses Drizzle's type-safe schema. A column add/rename
// requires updating both. The scan-order risk (a reordered SELECT with
// a matching reordered Scan compiles fine but corrupts data) is real
// but bounded — the lists are small and stable. Generating the Go
// column constants and scan bindings from the Drizzle schema (the
// contracts codegen pipeline proves the team can do codegen) is the
// long-term fix; not urgent for MVP.
package db

import (
	"context"
	"os"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	pool *pgxpool.Pool
	once sync.Once
)

// Pool lazily opens the shared connection pool. Serverless: each
// function cold start builds its own small pool; queries take the
// request context so delivery cancels cleanly.
func Pool() *pgxpool.Pool {
	once.Do(func() {
		url := os.Getenv("POSTGRES_URL")
		if url == "" {
			panic("POSTGRES_URL is not set")
		}
		cfg, err := pgxpool.ParseConfig(url)
		if err != nil {
			panic(err)
		}
		cfg.MaxConns = 5
		cfg.MaxConnLifetime = 10 * time.Minute
		pool, err = pgxpool.NewWithConfig(context.Background(), cfg)
		if err != nil {
			panic(err)
		}
	})
	return pool
}
