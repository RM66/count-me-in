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

// slidingWindowLua implements the whole sliding-window check as one
// atomic Redis script: the old TxPipeline
// could interleave between concurrent requests — two callers could both
// ZAdd before either ZCard runs, letting a burst slip past the limit.
// KEYS[1] = rate key; ARGV[1] = now (ns), ARGV[2] = window (ns),
// ARGV[3] = limit, ARGV[4] = unique member.
// Returns {allowed (0/1), retry_after_ns}.
var slidingWindowLua = goredis.NewScript(`
local window_start = tonumber(ARGV[1]) - tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '0', window_start)
local count = redis.call('ZCARD', KEYS[1])
if count >= tonumber(ARGV[3]) then
	local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
	-- Retry-After: the oldest hit ages out at oldest + window, so the
	-- caller waits oldest + window - now.
	local retry = tonumber(ARGV[2])
	if oldest[2] then
		retry = math.max(0, tonumber(oldest[2]) + tonumber(ARGV[2]) - tonumber(ARGV[1]))
	end
	return {0, retry}
end
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[4])
redis.call('PEXPIRE', KEYS[1], math.ceil(tonumber(ARGV[2]) / 1000000))
return {1, 0}
`)

// Allow checks the sliding-window limit for key. It returns true when
// the request is within the limit. On Redis failure it fails open — a
// limiter outage must never block traffic, and without REDIS_URL there
// is nothing to count against. The fail-open choice is recorded in
// ADR-019.
func Allow(ctx context.Context, key string, cfg RateLimitConfig) (allowed bool, retryAfter time.Duration) {
	if os.Getenv("REDIS_URL") == "" {
		return true, 0
	}
	client := redis.Client()
	now := time.Now()
	member := fmt.Sprintf("%d-%d", now.UnixNano(), rand.Int63())

	res, err := slidingWindowLua.Run(ctx, client, []string{key},
		now.UnixNano(), cfg.Window.Nanoseconds(), cfg.Limit, member).Slice()
	if err != nil {
		return true, 0
	}
	if len(res) < 2 {
		return true, 0
	}
	allowed64, _ := res[0].(int64)
	if allowed64 == 1 {
		return true, 0
	}
	retryNs, _ := res[1].(int64)
	if retryNs <= 0 {
		retryNs = cfg.Window.Nanoseconds()
	}
	return false, time.Duration(retryNs)
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

// TooManyRequests builds the 429 Response for guards that return a
// *Response instead of writing to the socket (e.g. inside
// RequireWritableOrganizer), carrying the Retry-After header.
func TooManyRequests(locale string, retryAfter time.Duration) *Response {
	resp := Error(http.StatusTooManyRequests, locale, "tooManyRequests")
	resp.Headers = map[string]string{
		"Retry-After": strconv.Itoa(int(math.Ceil(retryAfter.Seconds()))),
	}
	return resp
}

// ClientIP returns the caller's IP. Vercel sets x-vercel-forwarded-for
// (and x-forwarded-for); the first value is the original client, the
// rest are the proxy chain. Falls back to RemoteAddr in dev.
//
// Trust assumption: on Vercel the edge
// overwrites these headers, so they are trustworthy. If the function
// is ever reached without going through the edge (a misconfigured
// internal call, a non-Vercel deployment), a spoofed X-Forwarded-For
// would let an attacker rotate rate-limit keys. This is acceptable for
// the current Vercel-only deployment; revisit if the topology changes.
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
