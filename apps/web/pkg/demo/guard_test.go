package demo

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"countmein/pkg/authtest"
	"countmein/pkg/contracts"
)

// ADR-010: the demo organizer is read-only on EVERY write path, and an
// anonymous cabinet visitor is treated exactly like the demo account.
// These tests pin the guard itself; the per-route enforcement is pinned
// in pkg/httpx (guards_test.go) and pkg/db (booking_writes_test.go).

func TestIsReadOnly(t *testing.T) {
	cases := []struct {
		name string
		id   string
		want bool
	}{
		{"anonymous (empty id)", "", true},
		{"demo organizer id", contracts.DemoOrganizerID, true},
		{"regular organizer", "01930000-0000-7000-8000-000000000001", false},
		{"demo id with whitespace", " " + contracts.DemoOrganizerID, false},
	}
	for _, c := range cases {
		if got := IsReadOnly(c.id); got != c.want {
			t.Errorf("%s: IsReadOnly(%q) = %v, want %v", c.name, c.id, got, c.want)
		}
	}
}

func TestAssertNotDemo(t *testing.T) {
	for _, id := range []string{"", contracts.DemoOrganizerID} {
		err := AssertNotDemo(id)
		if err == nil {
			t.Fatalf("AssertNotDemo(%q) must refuse", id)
		}
		var readOnly DemoReadOnlyError
		if ok := func() bool {
			_, isReadOnly := err.(DemoReadOnlyError)
			return isReadOnly
		}(); !ok {
			_ = readOnly
			t.Fatalf("AssertNotDemo(%q) must return DemoReadOnlyError, got %T", id, err)
		}
		if err.Error() != contracts.DemoReadOnlyMessage {
			t.Errorf("error message must be the EN class message for logs, got %q", err.Error())
		}
	}
	if err := AssertNotDemo("01930000-0000-7000-8000-000000000001"); err != nil {
		t.Fatalf("regular organizer must pass, got %v", err)
	}
}

// ── ResolveCabinetOrganizerID ────────────────────────────────────────────────
//
// /cabinet requires no session (ADR-010): anonymous visitors see the
// demo organizer's data, signed-in organizers see their own. The
// session travels as the HS256 organizer-auth JWT minted by proxy.ts —
// tokens here come from the shared helper (single copy in pkg/authtest;
// the derivation itself is pinned by TestDerivedSigningKeyGolden in
// pkg/auth).

const testSecret = authtest.TestSecret

func mintTestToken(secret, sub, slug string, exp int64) string {
	return authtest.MintOrganizerToken(secret, sub, slug, exp)
}

func TestResolveCabinetOrganizerIDAnonymous(t *testing.T) {
	t.Setenv("AUTH_SECRET", testSecret)
	r := httptest.NewRequest(http.MethodGet, "/cabinet", nil)
	id, isDemo := ResolveCabinetOrganizerID(r)
	if id != contracts.DemoOrganizerID || !isDemo {
		t.Fatalf("anonymous request must resolve to the demo organizer, got %q (isDemo=%v)", id, isDemo)
	}
}

func TestResolveCabinetOrganizerIDSignedIn(t *testing.T) {
	t.Setenv("AUTH_SECRET", testSecret)
	const ownID = "01930000-0000-7000-8000-0000000000ff"
	r := httptest.NewRequest(http.MethodGet, "/cabinet", nil)
	r.Header.Set("X-Organizer-Auth", mintTestToken(testSecret, ownID, "studio", time.Now().Add(time.Minute).Unix()))
	id, isDemo := ResolveCabinetOrganizerID(r)
	if id != ownID || isDemo {
		t.Fatalf("signed-in organizer must see their own data, got %q (isDemo=%v)", id, isDemo)
	}
}

func TestResolveCabinetOrganizerIDDemoSession(t *testing.T) {
	t.Setenv("AUTH_SECRET", testSecret)
	r := httptest.NewRequest(http.MethodGet, "/cabinet", nil)
	r.Header.Set("X-Organizer-Auth", mintTestToken(testSecret, contracts.DemoOrganizerID, "demo", time.Now().Add(time.Minute).Unix()))
	id, isDemo := ResolveCabinetOrganizerID(r)
	if id != contracts.DemoOrganizerID || !isDemo {
		t.Fatalf("demo session must stay demo, got %q (isDemo=%v)", id, isDemo)
	}
}

func TestResolveCabinetOrganizerIDBrokenToken(t *testing.T) {
	t.Setenv("AUTH_SECRET", testSecret)
	r := httptest.NewRequest(http.MethodGet, "/cabinet", nil)
	r.Header.Set("X-Organizer-Auth", "garbage.token.here")
	id, isDemo := ResolveCabinetOrganizerID(r)
	if id != contracts.DemoOrganizerID || !isDemo {
		t.Fatalf("an unverifiable token is anonymous → demo, got %q (isDemo=%v)", id, isDemo)
	}
}
