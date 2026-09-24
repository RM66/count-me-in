package httpx

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"countmein/pkg/auth"
	"countmein/pkg/authtest"
	"countmein/pkg/contracts"
	"countmein/pkg/redis"

	"github.com/alicebob/miniredis/v2"
)

// the request-level doors every write passes. RequireWritableOrganizer
// closes "an anonymous visitor writes as an organizer" (ADR-010);
// RequireGuestIdentity closes "a replayed ticket books twice" (ADR-008,
// invariant 8). Redis-backed state (rate buckets, tickets) runs against
// miniredis via TestMain.

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

// mintTestToken is the shared organizer-auth mint (single copy in
// pkg/authtest); the derivation itself is pinned by
// TestDerivedSigningKeyGolden on the auth side.
const guardTestSecret = authtest.TestSecret

func mintTestToken(secret, sub, slug string, exp int64) string {
	return authtest.MintOrganizerToken(secret, sub, slug, exp)
}

func guardRequest() *http.Request {
	r := httptest.NewRequest(http.MethodPost, "/api/services", nil)
	return r
}

// ── RequireWritableOrganizer ──────────────────────────────────────────────────

func TestRequireWritableOrganizerAnonymous(t *testing.T) {
	t.Setenv("AUTH_SECRET", guardTestSecret)
	id, resp := RequireWritableOrganizer(guardRequest())
	if resp == nil || resp.Status != http.StatusForbidden {
		t.Fatalf("anonymous request must be refused as demo read-only, got id=%q resp=%+v", id, resp)
	}
	if id != "" {
		t.Fatalf("refused request must not leak an organizer id, got %q", id)
	}
}

func TestRequireWritableOrganizerDemoSession(t *testing.T) {
	t.Setenv("AUTH_SECRET", guardTestSecret)
	r := guardRequest()
	r.Header.Set(auth.OrganizerAuthHeader, mintTestToken(guardTestSecret, contracts.DemoOrganizerID, "demo", time.Now().Add(time.Minute).Unix()))
	id, resp := RequireWritableOrganizer(r)
	if resp == nil || resp.Status != http.StatusForbidden {
		t.Fatalf("demo session must be refused as demo read-only, got id=%q resp=%+v", id, resp)
	}
}

func TestRequireWritableOrganizerSignedIn(t *testing.T) {
	t.Setenv("AUTH_SECRET", guardTestSecret)
	// Unique id per test: the rate bucket is keyed by organizer id and
	// lives in the shared miniredis for the whole package run.
	const ownID = "01930000-0000-7000-8000-0000000000a1"
	r := guardRequest()
	r.Header.Set(auth.OrganizerAuthHeader, mintTestToken(guardTestSecret, ownID, "studio", time.Now().Add(time.Minute).Unix()))
	id, resp := RequireWritableOrganizer(r)
	if resp != nil {
		t.Fatalf("signed-in organizer must pass, got resp=%+v", resp)
	}
	if id != ownID {
		t.Fatalf("organizer id = %q, want %q", id, ownID)
	}
}

func TestRequireWritableOrganizerRateLimit(t *testing.T) {
	t.Setenv("AUTH_SECRET", guardTestSecret)
	const ownID = "01930000-0000-7000-8000-0000000000a2"
	minted := mintTestToken(guardTestSecret, ownID, "studio", time.Now().Add(time.Minute).Unix())

	// 60/min: the first 60 requests pass, the 61st is a 429.
	for i := 0; i < 60; i++ {
		r := guardRequest()
		r.Header.Set(auth.OrganizerAuthHeader, minted)
		id, resp := RequireWritableOrganizer(r)
		if resp != nil {
			t.Fatalf("request %d within the limit must pass, got resp=%+v", i+1, resp)
		}
		if id != ownID {
			t.Fatalf("request %d: id = %q", i+1, id)
		}
	}
	r := guardRequest()
	r.Header.Set(auth.OrganizerAuthHeader, minted)
	id, resp := RequireWritableOrganizer(r)
	if resp == nil || resp.Status != http.StatusTooManyRequests {
		t.Fatalf("request 61 must be a 429, got id=%q resp=%+v", id, resp)
	}
	if resp.Headers["Retry-After"] == "" {
		t.Fatal("429 must carry a Retry-After header")
	}
}

// ── RequireGuestIdentity ──────────────────────────────────────────────────────

func guestPayload(purpose string) contracts.AuthTicketPayload {
	return contracts.AuthTicketPayload{
		Messenger:   "telegram",
		MessengerID: "123456789",
		DisplayName: "Ann",
		Purpose:     purpose,
	}
}

func TestRequireGuestIdentityConsumeOnce(t *testing.T) {
	ticket, err := auth.IssueTicket(context.Background(), guestPayload(auth.TicketPurposeGuest))
	if err != nil {
		t.Fatal(err)
	}

	// First redemption: the payload comes back.
	payload, resp := RequireGuestIdentity(context.Background(), guardRequest(), ticket)
	if resp != nil {
		t.Fatalf("first redemption must pass, got resp=%+v", resp)
	}
	if payload == nil || payload.MessengerID != "123456789" || payload.Purpose != auth.TicketPurposeGuest {
		t.Fatalf("unexpected payload: %+v", payload)
	}

	// Replay: the ticket was consumed (GETDEL), so the second attempt is
	// answered like an expired one — 401, never a second identity.
	payload, resp = RequireGuestIdentity(context.Background(), guardRequest(), ticket)
	if resp == nil || resp.Status != http.StatusUnauthorized {
		t.Fatalf("replayed ticket must be a 401, got payload=%+v resp=%+v", payload, resp)
	}
}

func TestRequireGuestIdentityUnknownTicket(t *testing.T) {
	payload, resp := RequireGuestIdentity(context.Background(), guardRequest(), "no-such-ticket")
	if resp == nil || resp.Status != http.StatusUnauthorized {
		t.Fatalf("unknown ticket must be a 401, got payload=%+v resp=%+v", payload, resp)
	}
}

func TestRequireGuestIdentitySignupPurposeRefused(t *testing.T) {
	// ADR-008: a ticket minted for organizer registration must not be
	// redeemable in the booking flow — answered like an expired one so
	// the caller cannot distinguish "wrong flow" from "unknown ticket".
	ticket, err := auth.IssueTicket(context.Background(), guestPayload(auth.TicketPurposeOrganizer))
	if err != nil {
		t.Fatal(err)
	}
	payload, resp := RequireGuestIdentity(context.Background(), guardRequest(), ticket)
	if resp == nil || resp.Status != http.StatusUnauthorized {
		t.Fatalf("signup ticket in the booking flow must be a 401, got payload=%+v resp=%+v", payload, resp)
	}
	// And the refusal must have consumed it — it cannot be retried as guest either.
	payload, resp = RequireGuestIdentity(context.Background(), guardRequest(), ticket)
	if resp == nil || resp.Status != http.StatusUnauthorized {
		t.Fatalf("consumed ticket must be a 401 on retry, got payload=%+v resp=%+v", payload, resp)
	}
}

func TestRequireGuestIdentityBrokenPayload(t *testing.T) {
	// Corrupt JSON behind the key is "no payload usable" → 401, not a 500.
	testRedis.Set("auth:ticket:broken", "not-json{")
	payload, resp := RequireGuestIdentity(context.Background(), guardRequest(), "broken")
	if resp == nil || resp.Status != http.StatusUnauthorized {
		t.Fatalf("broken ticket payload must be a 401, got payload=%+v resp=%+v", payload, resp)
	}
}

// TestRequireGuestIdentityRedisDown — identity is NOT fail-open (ADR-019):
// only the rate limiter fails open; a Redis outage must refuse the write
// with a 500 rather than let an unverifiable identity through.
//
// Isolated from the shared miniredis: it points the singleton at a dead
// socket and restores it in Cleanup, so test order (including -shuffle)
// cannot break later Redis-backed tests in this package.
func TestRequireGuestIdentityRedisDown(t *testing.T) {
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
	payload, resp := RequireGuestIdentity(context.Background(), guardRequest(), "any-ticket")
	if resp == nil || resp.Status != http.StatusInternalServerError {
		t.Fatalf("Redis outage must be a 500 for identity, got payload=%+v resp=%+v", payload, resp)
	}
}
