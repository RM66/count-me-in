package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"time"

	"api-go/internal/contracts"
	redis "api-go/internal/redis"

	goredis "github.com/redis/go-redis/v9"
)

// Short-lived auth tickets (ADR-008): issued after server-side HMAC
// validation of the Telegram Login Widget payload; single-use (a
// replayed booking fails), 10-minute TTL. Key: auth:ticket:{token}.
const TicketTTL = 10 * time.Minute

const ticketKeyPrefix = "auth:ticket:"
const ticketBytes = 32

func ticketKey(token string) string {
	return ticketKeyPrefix + token
}

// newSecretToken is a 32-byte base64url token (43 chars) — sized to be
// unguessable rather than short: it is never typed by hand.
func newSecretToken() string {
	b := make([]byte, ticketBytes)
	if _, err := rand.Read(b); err != nil {
		panic(errors.New("crypto/rand unavailable: " + err.Error()))
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// IssueTicket stores the identity behind a fresh one-shot token.
func IssueTicket(ctx context.Context, payload contracts.AuthTicketPayload) (string, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	token := newSecretToken()
	if err := redis.Client().Set(ctx, ticketKey(token), raw, TicketTTL).Err(); err != nil {
		return "", err
	}
	return token, nil
}

// missingOrBroken maps "no payload usable" to (nil, nil); a Redis
// failure (other than a missing key) propagates as an error.
func missingOrBroken[T any](raw string, err error) (*T, error) {
	if errors.Is(err, goredis.Nil) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var payload T
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return nil, nil
	}
	return &payload, nil
}

// PeekTicket reads a ticket without consuming it — the registration
// form is in flight and the Auth.js sign-in still needs the ticket.
func PeekTicket(ctx context.Context, token string) (*contracts.AuthTicketPayload, error) {
	raw, err := redis.Client().Get(ctx, ticketKey(token)).Result()
	return missingOrBroken[contracts.AuthTicketPayload](raw, err)
}

// ConsumeTicket atomically reads and deletes a ticket (GETDEL) — what
// makes it single-use: two concurrent redemptions race on one Redis
// command and only the winner receives a payload.
func ConsumeTicket(ctx context.Context, token string) (*contracts.AuthTicketPayload, error) {
	raw, err := redis.Client().GetDel(ctx, ticketKey(token)).Result()
	return missingOrBroken[contracts.AuthTicketPayload](raw, err)
}
