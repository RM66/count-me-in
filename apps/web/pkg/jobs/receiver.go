package jobs

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/sha512"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

// QStash signature verification (port of @upstash/qstash@2.11.3's
// Receiver, which verifies via jose with the signing key as the HMAC
// secret). The upstash-signature header is a JWT:
//
//   - HS256 (or HS384/HS512) over "header.payload", the secret being
//     the raw UTF-8 bytes of the current or next signing key;
//   - issuer claim "Upstash";
//   - exp claim checked with no clock tolerance (the TS route passes
//     none — jose defaults to 0);
//   - body claim = base64url(SHA-256(request body)); trailing "="
//     padding stripped on both sides before comparing.
//
// Try currentSigningKey first, then nextSigningKey (key rotation).

type qstashHeader struct {
	Alg string `json:"alg"`
	Typ string `json:"typ"`
}

type qstashClaims struct {
	Iss  string `json:"iss"`
	Sub  string `json:"sub"`
	Exp  int64  `json:"exp"`
	Nbf  int64  `json:"nbf"`
	Body string `json:"body"`
}

// VerifyQStashSignature checks a delivery's upstash-signature against
// the raw body bytes. The signature covers the exact bytes of the body,
// so callers must pass them unmodified.
func VerifyQStashSignature(body []byte, signature, currentSigningKey, nextSigningKey string) bool {
	if signature == "" {
		return false
	}
	claims, ok := verifyWithKey(signature, currentSigningKey)
	if !ok {
		claims, ok = verifyWithKey(signature, nextSigningKey)
	}
	if !ok {
		return false
	}
	// Body hash: base64url(SHA-256(body)), padding-insensitive compare.
	sum := sha256.Sum256(body)
	bodyHash := strings.TrimRight(base64.RawURLEncoding.EncodeToString(sum[:]), "=")
	if strings.TrimRight(claims.Body, "=") != bodyHash {
		return false
	}
	return true
}

func verifyWithKey(signature, key string) (*qstashClaims, bool) {
	parts := strings.Split(signature, ".")
	if len(parts) != 3 {
		return nil, false
	}
	headerJSON, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, false
	}
	var header qstashHeader
	if err := json.Unmarshal(headerJSON, &header); err != nil {
		return nil, false
	}
	mac, ok := hmacForAlg(header.Alg, key, parts[0]+"."+parts[1])
	if !ok {
		return nil, false
	}
	if subtle.ConstantTimeCompare([]byte(mac), []byte(parts[2])) != 1 {
		return nil, false
	}

	claimsJSON, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, false
	}
	var claims qstashClaims
	if err := json.Unmarshal(claimsJSON, &claims); err != nil {
		return nil, false
	}
	// jose checks: issuer must match; exp/nbf honored (0 clock
	// tolerance, mirroring the TS route).
	if claims.Iss != "Upstash" {
		return nil, false
	}
	now := time.Now().Unix()
	if claims.Exp != 0 && now > claims.Exp {
		return nil, false
	}
	if claims.Nbf != 0 && now < claims.Nbf {
		return nil, false
	}
	return &claims, true
}

func hmacForAlg(alg, key, msg string) (sig string, ok bool) {
	switch alg {
	case "HS256":
		m := hmac.New(sha256.New, []byte(key))
		m.Write([]byte(msg))
		return base64.RawURLEncoding.EncodeToString(m.Sum(nil)), true
	case "HS384":
		m := hmac.New(sha512.New384, []byte(key))
		m.Write([]byte(msg))
		return base64.RawURLEncoding.EncodeToString(m.Sum(nil)), true
	case "HS512":
		m := hmac.New(sha512.New, []byte(key))
		m.Write([]byte(msg))
		return base64.RawURLEncoding.EncodeToString(m.Sum(nil)), true
	}
	return "", false
}

// TraceIDFromRequest reads the trace-id header forwarded by QStash
// (architecture review fix #5). The publisher sets Upstash-Trace-Id on
// the publish request; QStash forwards Upstash-* headers to the
// destination. Returns "" when absent (sweeper re-publish, legacy).
func TraceIDFromRequest(r *http.Request) string {
	return r.Header.Get("Upstash-Trace-Id")
}
