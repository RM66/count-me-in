package httpx

import (
	"context"
	"fmt"
	"math"
	"math/rand"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"countmein/pkg/i18n"
	"countmein/pkg/redis"
)

// RateLimitConfig describes a sliding-window limit: at most Limit
// requests per Window per key.
type RateLimitConfig struct {
	Limit  int
	Window time.Duration
}

// Allow checks the sliding-window limit for key. It returns true when
// the request is within the limit. On Redis failure it fails open — a
// limiter outage must never block traffic, and without REDIS_URL there
// is nothing to count against.
func Allow(ctx context.Context, key string, cfg RateLimitConfig) (allowed bool, retryAfter time.Duration) {
	if os.Getenv("REDIS_URL") == "" {
		return true, 0
	}
	client := redis.Client()
	now := time.Now()
	windowStart := now.Add(-cfg.Window)
	// Member must be unique per request so the sorted set holds one
	// entry per hit; timestamp + random is enough.
	member := fmt.Sprintf("%d-%d", now.UnixNano(), rand.Int63())

	pipe := client.TxPipeline()
	pipe.ZRemRangeByScore(ctx, key, "0", strconv.FormatInt(windowStart.UnixNano(), 10))
	pipe.ZAdd(ctx, key, goredis.Z{Score: float64(now.UnixNano()), Member: member})
	pipe.ZCard(ctx, key)
	pipe.ZRangeWithScores(ctx, key, 0, 0) // oldest member, for Retry-After
	pipe.Expire(ctx, key, cfg.Window)
	cmds, err := pipe.Exec(ctx)
	if err != nil {
		return true, 0
	}

	count := cmds[2].(*goredis.IntCmd).Val()
	if count <= int64(cfg.Limit) {
		return true, 0
	}

	// Over the limit: Retry-After is how long until the oldest hit in
	// the window ages out. Fall back to the full window if unknown.
	if oldest, ok := cmds[3].(*goredis.ZSliceCmd); ok {
		if scores := oldest.Val(); len(scores) > 0 {
			oldestAt := time.Unix(0, int64(scores[0].Score))
			retryAfter = cfg.Window - now.Sub(oldestAt)
			if retryAfter < 0 {
				retryAfter = 0
			}
		}
	}
	if retryAfter <= 0 {
		retryAfter = cfg.Window
	}
	return false, retryAfter
}

// RateLimited enforces a sliding-window limit for key and answers 429
// (with Retry-After) when it is exceeded. It returns true when the
// request may proceed. Callers pass a key that already carries the
// identity dimension (IP, organizer id, …).
func RateLimited(w http.ResponseWriter, r *http.Request, key string, cfg RateLimitConfig) bool {
	allowed, retryAfter := Allow(r.Context(), key, cfg)
	if allowed {
		return true
	}
	w.Header().Set("Retry-After", strconv.Itoa(int(math.Ceil(retryAfter.Seconds()))))
	Error(http.StatusTooManyRequests, i18n.DetectLocale(r), "tooManyRequests").Write(w)
	return false
}

// ClientIP returns the caller's IP. Vercel sets x-vercel-forwarded-for
// (and x-forwarded-for); the first value is the original client, the
// rest are the proxy chain. Falls back to RemoteAddr in dev.
func ClientIP(r *http.Request) string {
	for _, header := range []string{"x-vercel-forwarded-for", "x-forwarded-for"} {
		if fwd := r.Header.Get(header); fwd != "" {
			if i := strings.IndexByte(fwd, ','); i >= 0 {
				return strings.TrimSpace(fwd[:i])
			}
			return strings.TrimSpace(fwd)
		}
	}
	return r.RemoteAddr
}
