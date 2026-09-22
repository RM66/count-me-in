package db

import (
	"context"
	"countmein/pkg/logx"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Querier is the read/write surface shared by the pool and an open
// transaction — lets the merge-patch routes run read→merge→write on one
// tx (two concurrent PUTs used to lose columns when the read and the
// write were separate snapshots).
type Querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Postgres SQLSTATE for a unique constraint violation — the code the
// postgres driver puts on the error when a unique index rejects a write.
const uniqueViolation = "23505"

// UniqueViolation returns the underlying *pgconn.PgError when err (or
// anything it wraps) is a 23505, else nil.
func UniqueViolation(err error) *pgconn.PgError {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == uniqueViolation {
		return pgErr
	}
	return nil
}

// NotFound maps pgx.ErrNoRows to (nil, nil) — callers answer 404.
func NotFound(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	return err
}

// newID generates a uuidv7 — the tables' ids have no DB default
// (Drizzle's $defaultFn ran JS-side), so ids are generated here.
func newID() string {
	id, err := uuid.NewV7()
	if err != nil {
		panic(errors.New("uuidv7 unavailable: " + err.Error()))
	}
	return id.String()
}

const nanoidAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"

// newServiceID mirrors nanoid(): 21 chars from the URL-safe alphabet.
// Uses rejection sampling to avoid modulo bias — 256 is not evenly
// divisible by 64, so int(v)%len(alphabet) would slightly favour the
// first 0..3 characters. Not security-critical (service IDs aren't
// secrets), but a faithful nanoid port rejects out-of-range bytes.
func newServiceID() string {
	const alphabetLen = byte(len(nanoidAlphabet)) // 64
	// Largest multiple of alphabetLen that fits in a byte — bytes
	// at or above this are rejected and re-rolled.
	const limit = 256 - (256 % 64) // 192
	b := make([]byte, 21)
	for i := 0; i < len(b); {
		if _, err := rand.Read(b[i : i+1]); err != nil {
			panic(errors.New("crypto/rand unavailable: " + err.Error()))
		}
		if int(b[i]) >= limit {
			continue // reject — re-roll this byte
		}
		b[i] = nanoidAlphabet[b[i]%alphabetLen]
		i++
	}
	return string(b)
}

// newManageToken — 32 bytes base64url; the credential guarding
// /booking/{manageToken}, never typed by hand.
func newManageToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(errors.New("crypto/rand unavailable: " + err.Error()))
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// HashManageToken — SHA-256 hex of the manage token, the lookup key
// for cancel and the guest management page.
// The raw token is stored only for the flows that must re-issue the
// deep link; every credential check goes through this hash.
func HashManageToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// parseStringArray decodes array_to_json() output: NULL (nil raw) or
// "null" → nil slice; else a JSON array of strings. Selected this
// projection over pgx array scanning for explicit NULL handling.
// A malformed value is logged, not silently swallowed: "no options"
// and "corrupt options" must be distinguishable in the logs.
func parseStringArray(raw *string) []string {
	if raw == nil || *raw == "null" {
		return nil
	}
	var out []string
	if err := json.Unmarshal([]byte(*raw), &out); err != nil {
		logx.Error(err, map[string]any{"scope": "parse-string-array", "raw": *raw})
		return nil
	}
	return out
}

func strPtr(s string) *string { return &s }
