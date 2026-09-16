// Package db is the server end of the data wire: Postgres reads and
// writes via pgx, one file per entity, DTO mapping included. Route
// handlers must not run SQL inline (AGENTS.md).
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
