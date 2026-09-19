package jobs

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/base64"
	"encoding/json"
	"testing"
	"time"
)

// The signature is produced with the same primitives jose uses on the
// Upstash side (HS256 JWT, signing key as raw secret, body claim =
// base64url SHA-256), hand-built here so the test anchors the wire
// contract instead of the implementation.
func signQStash(key, body string, claims map[string]any) string {
	if claims == nil {
		claims = map[string]any{}
	}
	claims["iss"] = "Upstash"
	if _, ok := claims["exp"]; !ok {
		claims["exp"] = time.Now().Add(time.Hour).Unix()
	}
	sum := sha256.Sum256([]byte(body))
	claims["body"] = base64.RawURLEncoding.EncodeToString(sum[:])

	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	payload, _ := json.Marshal(claims)
	payloadB64 := base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, []byte(key))
	mac.Write([]byte(header + "." + payloadB64))
	return header + "." + payloadB64 + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

const (
	currentKey = "sig-current-key-0000000000000000"
	nextKey    = "sig-next-key-0000000000000000000000"
)

func TestVerifyQStashSignatureCurrentKey(t *testing.T) {
	sig := signQStash(currentKey, `{"bookingId":"x"}`, nil)
	if !VerifyQStashSignature([]byte(`{"bookingId":"x"}`), sig, currentKey, nextKey) {
		t.Fatal("signature with the current key must verify")
	}
}

func TestVerifyQStashSignatureRotation(t *testing.T) {
	// Rotated keys: current no longer matches, next must.
	sig := signQStash(nextKey, `{"bookingId":"x"}`, nil)
	if !VerifyQStashSignature([]byte(`{"bookingId":"x"}`), sig, currentKey, nextKey) {
		t.Fatal("signature with the next key must verify")
	}
	// And it must NOT verify as if it were signed by current.
	if VerifyQStashSignature([]byte(`{"bookingId":"x"}`), sig, currentKey, "unrelated") {
		t.Fatal("next-key signature must not verify against unrelated keys")
	}
}

func TestVerifyQStashSignatureBodyMismatch(t *testing.T) {
	sig := signQStash(currentKey, `{"bookingId":"a"}`, nil)
	if VerifyQStashSignature([]byte(`{"bookingId":"b"}`), sig, currentKey, nextKey) {
		t.Fatal("body hash mismatch must fail")
	}
}

func TestVerifyQStashSignatureExpired(t *testing.T) {
	sig := signQStash(currentKey, "body", map[string]any{
		"exp": time.Now().Add(-time.Hour).Unix(),
	})
	if VerifyQStashSignature([]byte("body"), sig, currentKey, nextKey) {
		t.Fatal("expired signature must fail (0 clock tolerance)")
	}
}

func TestVerifyQStashSignatureWrongIssuer(t *testing.T) {
	sum := sha256.Sum256([]byte("body"))
	sig := signWithClaims(map[string]any{
		"iss":  "Someone Else",
		"exp":  time.Now().Add(time.Hour).Unix(),
		"body": base64.RawURLEncoding.EncodeToString(sum[:]),
	}, currentKey)
	if VerifyQStashSignature([]byte("body"), sig, currentKey, nextKey) {
		t.Fatal("issuer must be Upstash")
	}
}

func TestVerifyQStashSignatureGarbage(t *testing.T) {
	for _, sig := range []string{"", "not-a-jwt", "a.b", "a.b.c.d"} {
		if VerifyQStashSignature([]byte("body"), sig, currentKey, nextKey) {
			t.Fatalf("garbage signature %q must fail", sig)
		}
	}
}

func TestVerifyQStashSignaturePaddedBodyClaim(t *testing.T) {
	// The claim may arrive with "=" padding; comparison strips it on
	// both sides (parity with the TS Receiver).
	sum := sha256.Sum256([]byte("body"))
	sig := signWithClaims(map[string]any{
		"exp":  time.Now().Add(time.Hour).Unix(),
		"body": base64.URLEncoding.EncodeToString(sum[:]), // padded
	}, currentKey)
	if !VerifyQStashSignature([]byte("body"), sig, currentKey, nextKey) {
		t.Fatal("padded body claim must verify")
	}
}

func signWithClaims(claims map[string]any, key string) string {
	if _, ok := claims["iss"]; !ok {
		claims["iss"] = "Upstash"
	}
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	payload, _ := json.Marshal(claims)
	payloadB64 := base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, []byte(key))
	mac.Write([]byte(header + "." + payloadB64))
	return header + "." + payloadB64 + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

var _ = sha512.New // keep sha512 referenced if algs change
