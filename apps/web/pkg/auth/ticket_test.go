package auth

import (
	"context"
	"os"
	"testing"
	"time"

	"countmein/pkg/contracts"
	"countmein/pkg/redis"

	"github.com/alicebob/miniredis/v2"
)

// auth tickets (ADR-008) — single-use, 10-minute TTL, purpose-bound.
// Redis-backed, so the package gets a TestMain with miniredis; the
// existing session/telegram tests never touch Redis.

var testRedis *miniredis.Miniredis

func TestMain(m *testing.M) {
	mr, err := miniredis.Run()
	if err != nil {
		panic("miniredis: " + err.Error())
	}
	testRedis = mr
	defer testRedis.Close()
	os.Setenv("REDIS_URL", "redis://"+testRedis.Addr())
	os.Exit(m.Run())
}

func ticketPayload(purpose string) contracts.AuthTicketPayload {
	return contracts.AuthTicketPayload{
		Messenger:      "telegram",
		MessengerID:    "123456789",
		DisplayName:    "Ann",
		MessengerLogin: nil,
		Purpose:        purpose,
	}
}

func TestIssuePeekConsumeTicket(t *testing.T) {
	ctx := context.Background()
	token, err := IssueTicket(ctx, ticketPayload(TicketPurposeGuest))
	if err != nil {
		t.Fatal(err)
	}
	if len(token) != 43 {
		t.Fatalf("ticket must be a 43-char base64url token, got %d (%q)", len(token), token)
	}

	// Peek does not consume — the registration flow reads the ticket
	// while the Auth.js sign-in still needs it.
	peeked, err := PeekTicket(ctx, token)
	if err != nil || peeked == nil {
		t.Fatalf("PeekTicket must return the payload, got %v, %v", peeked, err)
	}
	if peeked.MessengerID != "123456789" || peeked.Purpose != TicketPurposeGuest {
		t.Fatalf("payload round-trip broken: %+v", peeked)
	}
	if again, _ := PeekTicket(ctx, token); again == nil {
		t.Fatal("a second Peek must still find the ticket (peek is not consume)")
	}

	// Consume returns the payload and deletes the key.
	consumed, err := ConsumeTicket(ctx, token)
	if err != nil || consumed == nil {
		t.Fatalf("ConsumeTicket must return the payload, got %v, %v", consumed, err)
	}
	if consumed.MessengerID != "123456789" {
		t.Fatalf("unexpected consumed payload: %+v", consumed)
	}

	// Single-use: a second consume finds nothing — this is what makes a
	// replayed booking fail (invariant 8).
	replayed, err := ConsumeTicket(ctx, token)
	if err != nil {
		t.Fatalf("replayed consume must be (nil, nil), got error %v", err)
	}
	if replayed != nil {
		t.Fatalf("replayed consume must return nil, got %+v", replayed)
	}
}

func TestConsumeTicketUnknown(t *testing.T) {
	payload, err := ConsumeTicket(context.Background(), "no-such-ticket")
	if err != nil || payload != nil {
		t.Fatalf("unknown ticket must be (nil, nil), got %v, %v", payload, err)
	}
}

func TestTicketTTLExpires(t *testing.T) {
	ctx := context.Background()
	token, err := IssueTicket(ctx, ticketPayload(TicketPurposeGuest))
	if err != nil {
		t.Fatal(err)
	}
	// Advance miniredis's clock past the TTL — the key evaporates.
	testRedis.FastForward(TicketTTL + time.Second)
	payload, err := ConsumeTicket(ctx, token)
	if err != nil || payload != nil {
		t.Fatalf("expired ticket must be (nil, nil), got %v, %v", payload, err)
	}
}

func TestTicketPurposeRoundTrip(t *testing.T) {
	ctx := context.Background()
	// guest ≠ signup: the purpose claim survives the Redis round trip,
	// so RequireGuestIdentity can refuse a registration ticket.
	for _, purpose := range []string{TicketPurposeGuest, TicketPurposeOrganizer} {
		token, err := IssueTicket(ctx, ticketPayload(purpose))
		if err != nil {
			t.Fatal(err)
		}
		payload, err := ConsumeTicket(ctx, token)
		if err != nil || payload == nil {
			t.Fatalf("consume(%q): %v, %v", purpose, payload, err)
		}
		if payload.Purpose != purpose {
			t.Fatalf("purpose round-trip: got %q, want %q", payload.Purpose, purpose)
		}
	}
}

func TestConsumeTicketBrokenPayload(t *testing.T) {
	// Corrupt JSON behind the key is "no payload usable" → (nil, nil),
	// not an error: the caller answers 401 like an unknown ticket.
	testRedis.Set("auth:ticket:broken", "{not json")
	payload, err := ConsumeTicket(context.Background(), "broken")
	if err != nil || payload != nil {
		t.Fatalf("broken payload must be (nil, nil), got %v, %v", payload, err)
	}
}

// TestConsumeTicketRedisDown — a Redis failure propagates as an error
// (identity is not fail-open, ADR-019); the route answers 500.
//
// Isolated from the shared miniredis: it points the singleton at a dead
// socket and restores it in Cleanup, so test order (including -shuffle)
// cannot break later Redis-backed tests.
func TestConsumeTicketRedisDown(t *testing.T) {
	doomed, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	addr := doomed.Addr()
	doomed.Close() // dialing the closed socket fails fast
	// t.Setenv restores REDIS_URL at test end; the cleanup only has to drop
	// the singleton, which re-reads the restored env on next use.
	t.Setenv("REDIS_URL", "redis://"+addr)
	redis.ResetForTest()
	t.Cleanup(redis.ResetForTest)
	if _, err := ConsumeTicket(context.Background(), "any"); err == nil {
		t.Fatal("Redis outage must surface as an error, not (nil, nil)")
	}
}
