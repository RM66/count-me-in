package jobs

import (
	"crypto/hmac"
	"crypto/sha256"
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
	if _, ok := claims["sub"]; !ok {
		claims["sub"] = testSub
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
	testSub    = "https://countmein.group/api/jobs/booking.created"
)

func TestVerifyQStashSignatureCurrentKey(t *testing.T) {
	sig := signQStash(currentKey, `{"bookingId":"x"}`, nil)
	if !VerifyQStashSignature([]byte(`{"bookingId":"x"}`), sig, currentKey, nextKey, testSub) {
		t.Fatal("signature with the current key must verify")
	}
}

func TestVerifyQStashSignatureRotation(t *testing.T) {
	// Rotated keys: current no longer matches, next must.
	sig := signQStash(nextKey, `{"bookingId":"x"}`, nil)
	if !VerifyQStashSignature([]byte(`{"bookingId":"x"}`), sig, currentKey, nextKey, testSub) {
		t.Fatal("signature with the next key must verify")
	}
	// And it must NOT verify as if it were signed by current.
	if VerifyQStashSignature([]byte(`{"bookingId":"x"}`), sig, currentKey, "unrelated", testSub) {
		t.Fatal("next-key signature must not verify against unrelated keys")
	}
}

func TestVerifyQStashSignatureBodyMismatch(t *testing.T) {
	sig := signQStash(currentKey, `{"bookingId":"a"}`, nil)
	if VerifyQStashSignature([]byte(`{"bookingId":"b"}`), sig, currentKey, nextKey, testSub) {
		t.Fatal("body hash mismatch must fail")
	}
}

func TestVerifyQStashSignatureExpired(t *testing.T) {
	sig := signQStash(currentKey, "body", map[string]any{
		"exp": time.Now().Add(-time.Hour).Unix(),
	})
	if VerifyQStashSignature([]byte("body"), sig, currentKey, nextKey, testSub) {
		t.Fatal("expired signature must fail (past the 60s clock tolerance)")
	}
}

func TestVerifyQStashSignatureWrongIssuer(t *testing.T) {
	sum := sha256.Sum256([]byte("body"))
	sig := signWithClaims(map[string]any{
		"iss":  "Someone Else",
		"exp":  time.Now().Add(time.Hour).Unix(),
		"sub":  testSub,
		"body": base64.RawURLEncoding.EncodeToString(sum[:]),
	}, currentKey)
	if VerifyQStashSignature([]byte("body"), sig, currentKey, nextKey, testSub) {
		t.Fatal("issuer must be Upstash")
	}
}

func TestVerifyQStashSignatureWrongSub(t *testing.T) {
	// The sub claim binds the token to one destination queue; a token
	// minted for another queue must not verify here.
	sig := signQStash(currentKey, "body", map[string]any{
		"sub": "https://countmein.group/api/jobs/booking.cancelled",
	})
	if VerifyQStashSignature([]byte("body"), sig, currentKey, nextKey, testSub) {
		t.Fatal("sub mismatch must fail")
	}
}

func TestVerifyQStashSignatureGarbage(t *testing.T) {
	for _, sig := range []string{"", "not-a-jwt", "a.b", "a.b.c.d"} {
		if VerifyQStashSignature([]byte("body"), sig, currentKey, nextKey, testSub) {
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
		"sub":  testSub,
		"body": base64.URLEncoding.EncodeToString(sum[:]), // padded
	}, currentKey)
	if !VerifyQStashSignature([]byte("body"), sig, currentKey, nextKey, testSub) {
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
