package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const testSecret = "test-golden-secret"

// mintTestToken produces an HS256 compact JWT matching the format
// mintOrganizerAuth in organizer-token.ts, signing with the same
// HKDF-derived key.
func mintTestToken(secret, sub, slug string, exp int64) string {
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	payload, _ := json.Marshal(map[string]any{
		"sub":  sub,
		"slug": slug,
		"iat":  time.Now().Unix(),
		"exp":  exp,
	})
	payloadEncoded := base64.RawURLEncoding.EncodeToString(payload)
	signingInput := header + "." + payloadEncoded
	mac := hmac.New(sha256.New, derivedSigningKey(secret))
	mac.Write([]byte(signingInput))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return signingInput + "." + sig
}

// TestDerivedSigningKeyGolden pins the HKDF derivation to Node's
// crypto.hkdfSync('sha256', secret, 'countmein',
// 'CountMeIn Organizer API Token Key v1', 32) — the cross-language
// anchor. If this test fails after touching either side's derivation
// parameters, the TS and Go keys have drifted and every signed-in
// organizer silently becomes anonymous.
func TestDerivedSigningKeyGolden(t *testing.T) {
	want, err := hex.DecodeString("6d1ed228ced7fcfff1fc563e2f14f95c2e542a579d0eb2896e27ee93d0dd4318")
	if err != nil {
		t.Fatal(err)
	}
	got := derivedSigningKey(testSecret)
	if !hmac.Equal(got, want) {
		t.Fatalf("HKDF derivation mismatch:\n got %x\nwant %x", got, want)
	}
}

func TestVerifyOrganizerAuthValid(t *testing.T) {
	token := mintTestToken(testSecret, "01930000-0000-7000-8000-000000000001", "studio",
		time.Now().Add(time.Minute).Unix())
	claims, err := verifyOrganizerAuth(token, testSecret)
	if err != nil {
		t.Fatalf("valid token must verify: %v", err)
	}
	if claims.Sub != "01930000-0000-7000-8000-000000000001" || claims.Slug != "studio" {
		t.Fatalf("unexpected claims: %+v", claims)
	}
}

func TestVerifyOrganizerAuthWrongSecret(t *testing.T) {
	token := mintTestToken(testSecret, "sub", "slug", time.Now().Add(time.Minute).Unix())
	if _, err := verifyOrganizerAuth(token, "another-secret"); err == nil {
		t.Fatal("wrong secret must not verify")
	}
}

func TestVerifyOrganizerAuthExpired(t *testing.T) {
	token := mintTestToken(testSecret, "sub", "slug", time.Now().Add(-time.Hour).Unix())
	if _, err := verifyOrganizerAuth(token, testSecret); err == nil {
		t.Fatal("expired token must be rejected")
	}
}

func TestVerifyOrganizerAuthWithinClockTolerance(t *testing.T) {
	// 10s past expiry — within the 15s tolerance.
	token := mintTestToken(testSecret, "sub", "slug", time.Now().Add(-10*time.Second).Unix())
	if _, err := verifyOrganizerAuth(token, testSecret); err != nil {
		t.Fatalf("token within clock tolerance must verify: %v", err)
	}
}

func TestVerifyOrganizerAuthGarbage(t *testing.T) {
	for _, token := range []string{"", "not-a-token", "a.b", "a.b.c.d", "a.b.c.x"} {
		if _, err := verifyOrganizerAuth(token, testSecret); err == nil {
			t.Fatalf("garbage token %q must not verify", token)
		}
	}
}

func TestVerifyOrganizerAuthWrongAlg(t *testing.T) {
	// Build a token with alg "none" — must be rejected.
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"none","typ":"JWT"}`))
	payload := base64.RawURLEncoding.EncodeToString([]byte(`{"sub":"x","exp":9999999999}`))
	signingInput := header + "." + payload
	mac := hmac.New(sha256.New, derivedSigningKey(testSecret))
	mac.Write([]byte(signingInput))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	token := signingInput + "." + sig
	if _, err := verifyOrganizerAuth(token, testSecret); err == nil {
		t.Fatal("non-HS256 alg must be rejected")
	}
}

func TestVerifyOrganizerAuthEmptySub(t *testing.T) {
	token := mintTestToken(testSecret, "", "slug", time.Now().Add(time.Minute).Unix())
	if _, err := verifyOrganizerAuth(token, testSecret); err == nil {
		t.Fatal("empty sub must be rejected")
	}
}

func TestSessionFromRequestNoHeader(t *testing.T) {
	t.Setenv("AUTH_SECRET", testSecret)
	req := httptest.NewRequest(http.MethodPost, "/api/bookings", strings.NewReader("{}"))
	if s := SessionFromRequest(req); s != nil {
		t.Fatal("request without header must return nil session")
	}
}

func TestSessionFromRequestValidHeader(t *testing.T) {
	t.Setenv("AUTH_SECRET", testSecret)
	token := mintTestToken(testSecret, "01930000-0000-7000-8000-0000000000ff", "yoga",
		time.Now().Add(time.Minute).Unix())
	req := httptest.NewRequest(http.MethodPost, "/api/bookings", strings.NewReader("{}"))
	req.Header.Set(OrganizerAuthHeader, token)
	s := SessionFromRequest(req)
	if s == nil {
		t.Fatal("valid header must return a session")
	}
	if s.OrganizerID != "01930000-0000-7000-8000-0000000000ff" || s.Slug != "yoga" {
		t.Fatalf("unexpected session: %+v", s)
	}
}

func TestSessionFromRequestNoSecret(t *testing.T) {
	t.Setenv("AUTH_SECRET", "")
	token := mintTestToken("whatever", "sub", "slug", time.Now().Add(time.Minute).Unix())
	req := httptest.NewRequest(http.MethodPost, "/api/bookings", strings.NewReader("{}"))
	req.Header.Set(OrganizerAuthHeader, token)
	if s := SessionFromRequest(req); s != nil {
		t.Fatal("missing AUTH_SECRET must return nil session")
	}
}
