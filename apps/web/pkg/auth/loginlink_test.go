package auth

import (
	"context"
	"testing"
	"time"

	"countmein/pkg/contracts"
)

// one-time login links — the deep link from a notification into the
// cabinet. Peek must not consume (link previewers fetch URLs before any
// human clicks); Consume is GETDEL, so a replayed POST cannot mint a
// second session. `next` must be a relative path (open-redirect guard).

func TestLoginLinkRoundTrip(t *testing.T) {
	ctx := context.Background()
	token, err := IssueLoginLink(ctx, "01930000-0000-7000-8000-000000000001", "/cabinet/bookings")
	if err != nil {
		t.Fatal(err)
	}

	peeked, err := PeekLoginLink(ctx, token)
	if err != nil || peeked == nil {
		t.Fatalf("PeekLoginLink must return the payload, got %v, %v", peeked, err)
	}
	if peeked.OrganizerID != "01930000-0000-7000-8000-000000000001" || peeked.Next != "/cabinet/bookings" {
		t.Fatalf("payload round-trip broken: %+v", peeked)
	}
	// Peek is not consume — the landing page may look without spending.
	if again, _ := PeekLoginLink(ctx, token); again == nil {
		t.Fatal("a second Peek must still find the link")
	}

	consumed, err := ConsumeLoginLink(ctx, token)
	if err != nil || consumed == nil {
		t.Fatalf("ConsumeLoginLink must return the payload, got %v, %v", consumed, err)
	}
	// Single-use: the POST that consumes is the only redemption.
	if replayed, err := ConsumeLoginLink(ctx, token); err != nil || replayed != nil {
		t.Fatalf("replayed consume must be (nil, nil), got %v, %v", replayed, err)
	}
}

func TestLoginLinkUnknownToken(t *testing.T) {
	payload, err := ConsumeLoginLink(context.Background(), "no-such-token")
	if err != nil || payload != nil {
		t.Fatalf("unknown token must be (nil, nil), got %v, %v", payload, err)
	}
}

func TestLoginLinkTTL(t *testing.T) {
	// The stored TTL is the contracts constant — pin the key's lifetime
	// to it (30 days) rather than to an arbitrary number in this file.
	ctx := context.Background()
	token, err := IssueLoginLink(ctx, "01930000-0000-7000-8000-000000000002", "/cabinet")
	if err != nil {
		t.Fatal(err)
	}
	ttl := testRedis.TTL(contracts.LoginLinkKey(token))
	if ttl != time.Duration(contracts.LoginLinkTTLSeconds)*time.Second {
		t.Fatalf("login-link TTL = %v, want %ds", ttl, contracts.LoginLinkTTLSeconds)
	}
}

func TestLoginLinkRejectsAbsoluteNext(t *testing.T) {
	// Open-redirect guard: `next` is stored with the token, but a
	// payload carrying an absolute URL (or an empty organizer id) is
	// unusable — answered like an unknown token, (nil, nil).
	ctx := context.Background()
	for name, raw := range map[string]string{
		"absolute next":  `{"organizerId":"01930000-0000-7000-8000-000000000003","next":"https://evil.example.com"}`,
		"empty next":     `{"organizerId":"01930000-0000-7000-8000-000000000003","next":""}`,
		"empty org id":   `{"organizerId":"","next":"/cabinet"}`,
		"broken payload": "{not json",
	} {
		token := "link-" + name
		testRedis.Set(contracts.LoginLinkKey(token), raw)
		payload, err := PeekLoginLink(ctx, token)
		if err != nil || payload != nil {
			t.Fatalf("%s: must be (nil, nil), got %v, %v", name, payload, err)
		}
	}
}
