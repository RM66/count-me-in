package db

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

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

// parseStringArray decodes array_to_json() output: NULL (nil raw) or
// "null" → nil slice; else a JSON array of strings. Selected this
// projection over pgx array scanning for explicit NULL handling.
func parseStringArray(raw *string) []string {
	if raw == nil || *raw == "null" {
		return nil
	}
	var out []string
	if err := json.Unmarshal([]byte(*raw), &out); err != nil {
		return nil
	}
	return out
}

func strPtr(s string) *string { return &s }
