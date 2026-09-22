// Package db is the server end of the data wire: Postgres reads and
// writes via pgx, one file per entity, DTO mapping included. Route
// handlers must not run SQL inline (AGENTS.md).
//
// Schema knowledge is duplicated across two access patterns:
// this package hand-writes SQL with
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
	"errors"
	"os"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	pool    *pgxpool.Pool
	initErr error
	once    sync.Once
)

// Pool lazily opens the shared connection pool. Serverless: each
// function cold start builds its own small pool; queries take the
// request context so delivery cancels cleanly.
//
// A failed initialization is cached and re-panicked on every call:
// sync.Once marks itself done even when the
// function panics, so a plain panic inside once.Do would leave `pool`
// nil for the lifetime of the instance — every subsequent request
// nil-derefs into a 500 instead of a clear "POSTGRES_URL is not set".
func Pool() *pgxpool.Pool {
	once.Do(func() {
		url := os.Getenv("POSTGRES_URL")
		if url == "" {
			initErr = errors.New("POSTGRES_URL is not set")
			return
		}
		cfg, err := pgxpool.ParseConfig(url)
		if err != nil {
			initErr = err
			return
		}
		// Pool discipline: the fat lambda scales
		// to many concurrent instances, each with its own pool — MaxConns
		// must stay low so N × MaxConns cannot exhaust the Supavisor
		// pooler. MinConns=0 lets idle instances hold no connections.
		cfg.MaxConns = 3
		cfg.MinConns = 0
		cfg.MaxConnLifetime = 10 * time.Minute
		// Supavisor transaction mode routes each statement to a possibly
		// different backend, which breaks pgx's prepared-statement cache
		// ("prepared statement does not exist"). Simple protocol sends
		// parameters inline — no statement ids, safe behind any pooler.
		cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
		p, err := pgxpool.NewWithConfig(context.Background(), cfg)
		if err != nil {
			initErr = err
			return
		}
		pool = p
	})
	if initErr != nil {
		panic(initErr)
	}
	return pool
}
