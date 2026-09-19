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
	client *goredis.Client
	once   sync.Once
)

// Client returns the shared connection, opened on first use — a missing
// REDIS_URL surfaces at the call site rather than at import time.
func Client() *goredis.Client {
	once.Do(func() {
		url := os.Getenv("REDIS_URL")
		if url == "" {
			panic(errors.New("REDIS_URL is not set"))
		}
		opts, err := goredis.ParseURL(url)
		if err != nil {
			panic(err)
		}
		// Mirror @repo/redis: maxRetriesPerRequest 2.
		opts.MaxRetries = 2
		client = goredis.NewClient(opts)
	})
	return client
}
