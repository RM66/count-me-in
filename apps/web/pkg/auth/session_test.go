package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const testSecret = "test-organizer-auth-secret"

// mintTestToken produces an HS256 compact JWT matching the format
// mintOrganizerAuth in organizer-token.ts.
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
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(signingInput))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return signingInput + "." + sig
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
	mac := hmac.New(sha256.New, []byte(testSecret))
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
	t.Setenv("API_TOKEN_SECRET", testSecret)
	req := httptest.NewRequest(http.MethodPost, "/api/bookings", strings.NewReader("{}"))
	if s := SessionFromRequest(req); s != nil {
		t.Fatal("request without header must return nil session")
	}
}

func TestSessionFromRequestValidHeader(t *testing.T) {
	t.Setenv("API_TOKEN_SECRET", testSecret)
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
	t.Setenv("API_TOKEN_SECRET", "")
	token := mintTestToken("whatever", "sub", "slug", time.Now().Add(time.Minute).Unix())
	req := httptest.NewRequest(http.MethodPost, "/api/bookings", strings.NewReader("{}"))
	req.Header.Set(OrganizerAuthHeader, token)
	if s := SessionFromRequest(req); s != nil {
		t.Fatal("missing API_TOKEN_SECRET must return nil session")
	}
}
