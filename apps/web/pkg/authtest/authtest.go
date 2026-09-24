// Package authtest holds test-only helpers for the organizer-auth JWT.
//
// The Go verifier lives in pkg/auth (HS256, key derived from AUTH_SECRET
// via HKDF-SHA256, RFC 5869) and mirrors src/server/auth/organizer-token.ts.
// The derivation parameters must match on both sides — pinned by
// TestDerivedSigningKeyGolden in pkg/auth. Four test files used to
// re-implement the mint inline; a drift in any copy would turn green tests
// into a false sense of coverage while production silently treats every
// organizer as anonymous. Single copy lives here.
package authtest

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"time"
)

// TestSecret is a fixed signing secret for tests — never production data.
const TestSecret = "authtest-golden-secret"

// DerivedKey re-derives the HMAC signing key from a raw secret, mirroring
// derivedSigningKey in pkg/auth and mintOrganizerAuth in organizer-token.ts.
func DerivedKey(secret string) []byte {
	h := hmac.New(sha256.New, []byte("countmein"))
	h.Write([]byte(secret))
	prk := h.Sum(nil)
	h = hmac.New(sha256.New, prk)
	h.Write([]byte("CountMeIn Organizer API Token Key v1"))
	h.Write([]byte{1})
	return h.Sum(nil)[:32]
}

// MintOrganizerToken produces an HS256 compact JWT with {sub, slug, iat,
// exp} claims, signed with the derived key — the same shape proxy.ts mints.
func MintOrganizerToken(secret, sub, slug string, exp int64) string {
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	payload, _ := json.Marshal(map[string]any{
		"sub":  sub,
		"slug": slug,
		"iat":  time.Now().Unix(),
		"exp":  exp,
	})
	payloadB64 := base64.RawURLEncoding.EncodeToString(payload)
	signingInput := header + "." + payloadB64
	mac := hmac.New(sha256.New, DerivedKey(secret))
	mac.Write([]byte(signingInput))
	return signingInput + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
