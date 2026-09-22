// Package redis owns the shared Redis connection. Key names and
// payload shapes are contracts (loginLinkKey in pkg/contracts),
// mirroring @repo/contracts / @repo/redis in the TS monorepo.
package redis

import (
	"errors"
	"os"
	"sync"

	goredis "github.com/redis/go-redis/v9"
)

var (
	client  *goredis.Client
	initErr error
	once    sync.Once
)

// Client returns the shared connection, opened on first use — a missing
// REDIS_URL surfaces at the call site rather than at import time.
//
// A failed initialization is cached and re-panicked on every call:
// sync.Once marks itself done even when the
// function panics, so a plain panic inside once.Do would leave `client`
// nil for the lifetime of the instance — every subsequent request
// nil-derefs into a 500 instead of a clear "REDIS_URL is not set".
func Client() *goredis.Client {
	once.Do(func() {
		url := os.Getenv("REDIS_URL")
		if url == "" {
			initErr = errors.New("REDIS_URL is not set")
			return
		}
		opts, err := goredis.ParseURL(url)
		if err != nil {
			initErr = err
			return
		}
		// Mirror @repo/redis: maxRetriesPerRequest 2.
		opts.MaxRetries = 2
		client = goredis.NewClient(opts)
	})
	if initErr != nil {
		panic(initErr)
	}
	return client
}
